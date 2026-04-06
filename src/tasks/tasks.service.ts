import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { Task } from '@prisma/client';
import { CreateTaskDto, TaskStatus } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { BulkTaskDto, BulkTaskAction } from './dto/bulk-task.dto';

type TaskWithSubtasks = Task & { subtasks: Task[] };

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  private async assertMember(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }
  }

  async list(
    workspaceId: string,
    userId: string,
    query: QueryTaskDto,
  ): Promise<{ tasks: TaskWithSubtasks[]; total: number }> {
    await this.assertMember(workspaceId, userId);

    const where = {
      workspaceId,
      deletedAt: null,
      parentTaskId: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' as const } },
              { description: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.dueBefore || query.dueAfter
        ? {
            dueDate: {
              ...(query.dueBefore ? { lte: new Date(query.dueBefore) } : {}),
              ...(query.dueAfter ? { gte: new Date(query.dueAfter) } : {}),
            },
          }
        : {}),
    };

    const limit = query.limit ?? 50;
    const skip = query.skip ?? 0;

    const [tasks, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        include: {
          subtasks: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.task.count({ where }),
    ]);

    return { tasks: tasks as TaskWithSubtasks[], total };
  }

  async create(
    workspaceId: string,
    userId: string,
    dto: CreateTaskDto,
  ): Promise<Task> {
    await this.assertMember(workspaceId, userId);

    return this.prisma.task.create({
      data: {
        workspaceId,
        title: dto.title.trim(),
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        priority: dto.priority,
        status: dto.status ?? TaskStatus.PENDING,
        parentTaskId: dto.parentTaskId,
        completedAt:
          dto.status === TaskStatus.COMPLETED ? new Date() : undefined,
      },
    });
  }

  async findOne(
    workspaceId: string,
    id: string,
    userId: string,
  ): Promise<TaskWithSubtasks> {
    await this.assertMember(workspaceId, userId);

    const task = await this.prisma.task.findFirst({
      where: { id, workspaceId, deletedAt: null },
      include: {
        subtasks: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task as TaskWithSubtasks;
  }

  async update(
    workspaceId: string,
    id: string,
    userId: string,
    dto: UpdateTaskDto,
  ): Promise<Task> {
    const existing = await this.findOne(workspaceId, id, userId);

    const isCompleting =
      dto.status === TaskStatus.COMPLETED &&
      existing.status !== TaskStatus.COMPLETED;

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.dueDate !== undefined
          ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
          : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.parentTaskId !== undefined ? { parentTaskId: dto.parentTaskId } : {}),
        ...(isCompleting ? { completedAt: new Date() } : {}),
      },
    });

    if (isCompleting) {
      await this.analytics.logStat(workspaceId, userId, { tasksCompleted: 1 });
    }

    return updated;
  }

  async remove(workspaceId: string, id: string, userId: string): Promise<void> {
    await this.findOne(workspaceId, id, userId);
    await this.prisma.task.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async bulkUpdate(
    workspaceId: string,
    userId: string,
    dto: BulkTaskDto,
  ): Promise<{ affected: number }> {
    await this.assertMember(workspaceId, userId);

    // Validate all requested IDs belong to this workspace and are not deleted
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: dto.ids }, workspaceId, deletedAt: null },
      select: { id: true, status: true },
    });

    if (tasks.length === 0) {
      return { affected: 0 };
    }

    const validIds = tasks.map((t) => t.id);

    if (dto.action === BulkTaskAction.DELETE) {
      await this.prisma.task.updateMany({
        where: { id: { in: validIds } },
        data: { deletedAt: new Date() },
      });
      return { affected: validIds.length };
    }

    // action === complete
    const alreadyDoneIds = new Set(
      tasks.filter((t) => t.status === TaskStatus.COMPLETED).map((t) => t.id),
    );
    const toCompleteIds = validIds.filter((id) => !alreadyDoneIds.has(id));

    if (toCompleteIds.length > 0) {
      await this.prisma.task.updateMany({
        where: { id: { in: toCompleteIds } },
        data: { status: TaskStatus.COMPLETED, completedAt: new Date() },
      });
      await this.analytics.logStat(workspaceId, userId, {
        tasksCompleted: toCompleteIds.length,
      });
    }

    return { affected: toCompleteIds.length };
  }
}
