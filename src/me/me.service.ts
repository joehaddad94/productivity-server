import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Task } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import {
  resolveBucket,
  type CanonicalBucket,
} from '../task-statuses/canonical-status';
import { MeTasksLens, QueryMeTasksDto } from './dto/query-me-tasks.dto';
import { CreateMeTaskDto } from './dto/create-me-task.dto';

const ASSIGNEE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
} as const;

export type MeTaskApi = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  dueTime: string | null;
  priority: string | null;
  status: string;
  statusName: string | null;
  statusColor: string | null;
  canonicalBucket: CanonicalBucket;
  completedAt: string | null;
  parentTaskId: string | null;
  createdAt: string;
  workspace: { id: string; name: string; isPersonal: boolean };
  project: { id: string; name: string; color: string | null } | null;
  assignees: {
    userId: string;
    user: {
      id: string;
      email: string;
      name: string | null;
      avatarUrl: string | null;
    };
  }[];
};

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
  ) {}

  /**
   * Quick-add a task from the rollup. Resolves the target workspace (explicit,
   * else the caller's personal workspace) and delegates to TasksService.create
   * with the creator self-assigned so it appears in /me/tasks.
   */
  async quickAddTask(userId: string, dto: CreateMeTaskDto): Promise<Task> {
    const workspaceId = dto.workspaceId ?? (await this.personalWorkspaceId(userId));
    return this.tasks.create(workspaceId, userId, {
      title: dto.title,
      description: dto.description,
      dueDate: dto.dueDate,
      dueTime: dto.dueTime,
      priority: dto.priority,
      projectId: dto.projectId,
      assigneeIds: [userId],
    });
  }

  private async personalWorkspaceId(userId: string): Promise<string> {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId, workspace: { isPersonal: true, deletedAt: null } },
      select: { workspaceId: true },
    });
    if (!membership) {
      throw new BadRequestException('No personal workspace found for this user');
    }
    return membership.workspaceId;
  }

  /**
   * The personal cross-workspace rollup. See docs/task-model-and-rollup.md §6.3.
   *
   * "Mine" = tasks assigned to me in ANY workspace I belong to,
   *   UNION tasks I created in a personal workspace I belong to.
   * (Personal workspaces are NOT single-member — verified live 2026-07-20 — so we
   *  scope the personal branch to creator-or-assignee, never "all tasks".)
   */
  async getTasks(
    userId: string,
    query: QueryMeTasksDto,
  ): Promise<{ tasks: MeTaskApi[]; total: number }> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, workspace: { deletedAt: null } },
      select: { workspaceId: true, workspace: { select: { isPersonal: true } } },
    });

    const memberWorkspaceIds = memberships.map((m) => m.workspaceId);
    const personalWorkspaceIds = memberships
      .filter((m) => m.workspace.isPersonal)
      .map((m) => m.workspaceId);

    if (memberWorkspaceIds.length === 0) {
      return { tasks: [], total: 0 };
    }

    const lens = query.lens ?? MeTasksLens.List;

    const where: Prisma.TaskWhereInput = {
      deletedAt: null,
      workspaceId: { in: memberWorkspaceIds },
      OR: [
        { assignees: { some: { userId } } },
        ...(personalWorkspaceIds.length > 0
          ? [
              {
                workspaceId: { in: personalWorkspaceIds },
                creatorId: userId,
              } satisfies Prisma.TaskWhereInput,
            ]
          : []),
      ],
      ...(query.dueBefore || query.dueAfter || lens === MeTasksLens.Calendar
        ? {
            dueDate: {
              ...(query.dueBefore ? { lte: new Date(query.dueBefore) } : {}),
              ...(query.dueAfter ? { gte: new Date(query.dueAfter) } : {}),
              // calendar only deals with dated tasks
              ...(lens === MeTasksLens.Calendar ? { not: null } : {}),
            },
          }
        : {}),
    };

    const limit = query.limit ?? 200;
    const skip = query.skip ?? 0;

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: {
          workspace: { select: { id: true, name: true, isPersonal: true } },
          project: { select: { id: true, name: true, color: true } },
          assignees: {
            select: { userId: true, user: { select: ASSIGNEE_USER_SELECT } },
          },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: limit,
        skip,
      }),
      this.prisma.task.count({ where }),
    ]);

    // Build an id -> status-row lookup across the workspaces actually present,
    // so we can resolve both status ids and legacy bare-key statuses.
    const presentWorkspaceIds = [...new Set(tasks.map((t) => t.workspaceId))];
    const statusRows =
      presentWorkspaceIds.length > 0
        ? await this.prisma.workspaceTaskStatus.findMany({
            where: { workspaceId: { in: presentWorkspaceIds } },
            select: { id: true, key: true, isTerminal: true, name: true, color: true },
          })
        : [];
    const byId = new Map(statusRows.map((r) => [r.id, r]));

    const mapped = tasks.map((t): MeTaskApi => {
      const row = byId.get(t.status);
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        dueTime: t.dueTime,
        priority: t.priority,
        status: t.status,
        statusName: row?.name ?? null,
        statusColor: row?.color ?? null,
        canonicalBucket: resolveBucket(t.status, byId),
        completedAt: t.completedAt ? t.completedAt.toISOString() : null,
        parentTaskId: t.parentTaskId,
        createdAt: t.createdAt.toISOString(),
        workspace: t.workspace,
        project: t.project,
        assignees: t.assignees,
      };
    });

    return { tasks: mapped, total };
  }
}
