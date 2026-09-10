import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertMember } from '../common/assert-member';
import { deriveBucket, legacyKeyBucket } from './canonical-status';
import type { WorkspaceTaskStatus } from '@prisma/client';
import { CreateTaskStatusDto } from './dto/create-task-status.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';

export type TaskStatusApi = {
  id: string;
  workspaceId: string;
  name: string;
  sortOrder: number;
  isTerminal: boolean;
  color: string | null;
  archivedAt: string | null;
  createdAt: string;
};

@Injectable()
export class TaskStatusesService {
  constructor(private readonly prisma: PrismaService) {}

  private toApi(row: WorkspaceTaskStatus): TaskStatusApi {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      sortOrder: row.sortOrder,
      isTerminal: row.isTerminal,
      color: row.color,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Idempotent: inserts the three built-in rows if the workspace has none. */
  async seedDefaultsForWorkspace(workspaceId: string): Promise<void> {
    const count = await this.prisma.workspaceTaskStatus.count({
      where: { workspaceId },
    });
    if (count > 0) return;
    await this.prisma.workspaceTaskStatus.createMany({
      data: [
        {
          workspaceId,
          key: 'pending',
          name: 'Pending',
          sortOrder: 0,
          isTerminal: false,
        },
        {
          workspaceId,
          key: 'in_progress',
          name: 'In progress',
          sortOrder: 1,
          isTerminal: false,
        },
        {
          workspaceId,
          key: 'completed',
          name: 'Completed',
          sortOrder: 2,
          isTerminal: true,
        },
      ],
    });
  }

  async list(
    workspaceId: string,
    userId: string,
  ): Promise<{ statuses: TaskStatusApi[] }> {
    await assertMember(this.prisma, workspaceId, userId);
    await this.seedDefaultsForWorkspace(workspaceId);
    const rows = await this.prisma.workspaceTaskStatus.findMany({
      where: { workspaceId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { statuses: rows.map((r) => this.toApi(r)) };
  }

  async findById(
    workspaceId: string,
    statusId: string,
    userId: string,
  ): Promise<WorkspaceTaskStatus> {
    await assertMember(this.prisma, workspaceId, userId);
    const row = await this.prisma.workspaceTaskStatus.findFirst({
      where: { id: statusId, workspaceId },
    });
    if (!row) throw new NotFoundException('Task status not found');
    return row;
  }

  /**
   * Whether a `Task.status` value counts as done.
   *
   * Routed through the canonical derivation (docs/task-model-and-rollup.md §6.1)
   * so completion here and bucketing in the personal rollup can never disagree.
   * Tolerates both shapes the column holds: a WorkspaceTaskStatus id, and the
   * legacy bare keys (`pending` / `in_progress` / `completed`) still present on
   * pre-migration rows.
   */
  async isTerminal(workspaceId: string, statusId: string): Promise<boolean> {
    const row = await this.prisma.workspaceTaskStatus.findFirst({
      where: { id: statusId, workspaceId, archivedAt: null },
      select: { key: true, isTerminal: true },
    });
    if (row) return deriveBucket(row) === 'done';
    return legacyKeyBucket(statusId) === 'done';
  }

  async getDefaultOpenStatusId(workspaceId: string): Promise<string> {
    await this.seedDefaultsForWorkspace(workspaceId);
    const row = await this.prisma.workspaceTaskStatus.findFirst({
      where: { workspaceId, isTerminal: false, archivedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    if (!row)
      throw new BadRequestException(
        'No open task status configured for workspace',
      );
    return row.id;
  }

  async getFirstTerminalStatusId(workspaceId: string): Promise<string> {
    await this.seedDefaultsForWorkspace(workspaceId);
    const row = await this.prisma.workspaceTaskStatus.findFirst({
      where: { workspaceId, isTerminal: true, archivedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    if (!row)
      throw new BadRequestException(
        'No terminal task status configured for workspace',
      );
    return row.id;
  }

  async assertStatusInWorkspace(
    workspaceId: string,
    statusId: string,
  ): Promise<void> {
    const ok = await this.prisma.workspaceTaskStatus.findFirst({
      where: { id: statusId, workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!ok) {
      throw new BadRequestException('Invalid task status for this workspace');
    }
  }

  async create(
    workspaceId: string,
    userId: string,
    dto: CreateTaskStatusDto,
  ): Promise<{ status: TaskStatusApi }> {
    await assertMember(this.prisma, workspaceId, userId);
    const maxOrder = await this.prisma.workspaceTaskStatus.aggregate({
      where: { workspaceId },
      _max: { sortOrder: true },
    });
    const sortOrder = dto.sortOrder ?? (maxOrder._max.sortOrder ?? -1) + 1;
    const row = await this.prisma.workspaceTaskStatus.create({
      data: {
        workspaceId,
        key: null,
        name: dto.name.trim(),
        sortOrder,
        isTerminal: dto.isTerminal ?? false,
        color: dto.color ?? null,
      },
    });
    return { status: this.toApi(row) };
  }

  async update(
    workspaceId: string,
    statusId: string,
    userId: string,
    dto: UpdateTaskStatusDto,
  ): Promise<{ status: TaskStatusApi }> {
    const existing = await this.findById(workspaceId, statusId, userId);

    if (
      dto.isTerminal !== undefined &&
      dto.isTerminal !== existing.isTerminal
    ) {
      if (dto.isTerminal === false) {
        const otherTerminal = await this.prisma.workspaceTaskStatus.count({
          where: {
            workspaceId,
            isTerminal: true,
            archivedAt: null,
            id: { not: statusId },
          },
        });
        if (otherTerminal === 0) {
          throw new BadRequestException(
            'Workspace must keep at least one done-like status',
          );
        }
      } else {
        const otherOpen = await this.prisma.workspaceTaskStatus.count({
          where: {
            workspaceId,
            isTerminal: false,
            archivedAt: null,
            id: { not: statusId },
          },
        });
        if (otherOpen === 0) {
          throw new BadRequestException(
            'Workspace must keep at least one non-terminal status',
          );
        }
      }
    }

    const row = await this.prisma.workspaceTaskStatus.update({
      where: { id: statusId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isTerminal !== undefined ? { isTerminal: dto.isTerminal } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.archivedAt !== undefined
          ? {
              archivedAt:
                dto.archivedAt === null ? null : new Date(dto.archivedAt),
            }
          : {}),
      },
    });
    return { status: this.toApi(row) };
  }

  async remove(
    workspaceId: string,
    statusId: string,
    userId: string,
    replacementTaskStatusId?: string,
  ): Promise<void> {
    const existing = await this.findById(workspaceId, statusId, userId);

    const terminalCount = await this.prisma.workspaceTaskStatus.count({
      where: { workspaceId, isTerminal: true, archivedAt: null },
    });
    const openCount = await this.prisma.workspaceTaskStatus.count({
      where: { workspaceId, isTerminal: false, archivedAt: null },
    });
    if (existing.isTerminal && terminalCount <= 1) {
      throw new BadRequestException('Cannot delete the only done-like status');
    }
    if (!existing.isTerminal && openCount <= 1) {
      throw new BadRequestException('Cannot delete the only open status');
    }

    const usageCount = await this.prisma.task.count({
      where: { workspaceId, status: statusId, deletedAt: null },
    });

    if (usageCount > 0) {
      if (!replacementTaskStatusId) {
        throw new BadRequestException(
          'Provide replacementTaskStatusId when tasks still use this status',
        );
      }
      if (replacementTaskStatusId === statusId) {
        throw new BadRequestException(
          'Replacement status must differ from the deleted one',
        );
      }
      const replacement = await this.prisma.workspaceTaskStatus.findFirst({
        where: {
          id: replacementTaskStatusId,
          workspaceId,
          archivedAt: null,
        },
      });
      if (!replacement) {
        throw new BadRequestException('Invalid replacement task status');
      }
      await this.prisma.task.updateMany({
        where: { workspaceId, status: statusId, deletedAt: null },
        data: { status: replacementTaskStatusId },
      });
    }

    await this.prisma.workspaceTaskStatus.delete({ where: { id: statusId } });
  }

  /** Atomically swap the sortOrder of two statuses in one transaction. */
  async swap(
    workspaceId: string,
    userId: string,
    idA: string,
    idB: string,
  ): Promise<{ statuses: TaskStatusApi[] }> {
    await assertMember(this.prisma, workspaceId, userId);

    const [a, b] = await Promise.all([
      this.prisma.workspaceTaskStatus.findFirst({
        where: { id: idA, workspaceId },
      }),
      this.prisma.workspaceTaskStatus.findFirst({
        where: { id: idB, workspaceId },
      }),
    ]);
    if (!a || !b) throw new NotFoundException('One or both statuses not found');

    const [updatedA, updatedB] = await this.prisma.$transaction([
      this.prisma.workspaceTaskStatus.update({
        where: { id: idA },
        data: { sortOrder: b.sortOrder },
      }),
      this.prisma.workspaceTaskStatus.update({
        where: { id: idB },
        data: { sortOrder: a.sortOrder },
      }),
    ]);

    return { statuses: [this.toApi(updatedA), this.toApi(updatedB)] };
  }

  /** Status ids that count as “done” for notifications and filters. */
  async terminalStatusIds(workspaceId: string): Promise<string[]> {
    await this.seedDefaultsForWorkspace(workspaceId);
    const rows = await this.prisma.workspaceTaskStatus.findMany({
      where: { workspaceId, isTerminal: true, archivedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
