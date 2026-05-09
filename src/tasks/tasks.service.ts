import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { membershipCache, membershipKey } from '../common/membership-cache';
import { AnalyticsService } from '../analytics/analytics.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Task } from '@prisma/client';
import { CreateTaskDto, RecurrenceRule } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { BulkTaskDto, BulkTaskAction } from './dto/bulk-task.dto';
import { TaskStatusesService } from '../task-statuses/task-statuses.service';

type TaskWithSubtasks = Task & { subtasks: Task[] };

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly taskStatuses: TaskStatusesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async assertMember(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const key = membershipKey(userId, workspaceId);
    if (membershipCache.get(key)) return;
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!membership)
      throw new ForbiddenException("You don't have access to this workspace");
    membershipCache.set(key, true);
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
              {
                title: { contains: query.search, mode: 'insensitive' as const },
              },
              {
                description: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
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
      ...(query.projectId ? { projectId: query.projectId } : {}),
    };

    const limit = query.limit ?? 50;
    const skip = query.skip ?? 0;

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: {
          subtasks: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
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

    const statusId =
      dto.status ??
      (await this.taskStatuses.getDefaultOpenStatusId(workspaceId));
    await this.taskStatuses.assertStatusInWorkspace(workspaceId, statusId);
    const terminal = await this.taskStatuses.isTerminal(workspaceId, statusId);

    return this.prisma.task.create({
      data: {
        workspaceId,
        title: dto.title.trim(),
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        dueTime: dto.dueTime,
        priority: dto.priority,
        status: statusId,
        parentTaskId: dto.parentTaskId,
        recurrenceRule: dto.recurrenceRule,
        projectId: dto.projectId,
        completedAt: terminal ? new Date() : undefined,
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

    let completedAtPatch: Date | null | undefined = undefined;
    let isCompleting = false;

    if (dto.status !== undefined) {
      const [, wasTerminal, nowTerminal] = await Promise.all([
        this.taskStatuses.assertStatusInWorkspace(workspaceId, dto.status),
        this.taskStatuses.isTerminal(workspaceId, existing.status),
        this.taskStatuses.isTerminal(workspaceId, dto.status),
      ]);
      isCompleting = nowTerminal && !wasTerminal;
      if (isCompleting) completedAtPatch = new Date();
      else if (!nowTerminal && wasTerminal) completedAtPatch = null;
    }

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.dueDate !== undefined
          ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
          : {}),
        ...(dto.dueTime !== undefined ? { dueTime: dto.dueTime ?? null } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.parentTaskId !== undefined
          ? { parentTaskId: dto.parentTaskId }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.recurrenceRule !== undefined
          ? { recurrenceRule: dto.recurrenceRule ?? null }
          : {}),
        ...(dto.projectId !== undefined
          ? { projectId: dto.projectId ?? null }
          : {}),
        ...(completedAtPatch !== undefined
          ? { completedAt: completedAtPatch }
          : {}),
      },
    });

    if (isCompleting) {
      // Cascade completion to all non-terminal subtasks in parallel
      await this.prisma.task.updateMany({
        where: {
          parentTaskId: id,
          workspaceId,
          deletedAt: null,
          NOT: { status: dto.status! },
        },
        data: { status: dto.status!, completedAt: new Date() },
      });

      await Promise.all([
        this.analytics.logStat(workspaceId, userId, { tasksCompleted: 1 }),
        this.spawnNextRecurrence(existing, workspaceId),
        this.notifyOtherMembers(workspaceId, userId, updated.title),
      ]);
    }

    return updated;
  }

  private async notifyOtherMembers(
    workspaceId: string,
    completingUserId: string,
    taskTitle: string,
  ): Promise<void> {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { not: completingUserId } },
      include: { user: true },
    });
    if (members.length === 0) return;

    const completingUser = await this.prisma.user.findUnique({
      where: { id: completingUserId },
    });
    const name = completingUser?.name ?? completingUser?.email ?? 'Someone';

    await Promise.all(
      members.map((member) =>
        this.notificationsService.createAndDeliver({
          userId: member.userId,
          workspaceId,
          type: 'task_completed',
          title: 'Task completed',
          body: `${name} completed "${taskTitle}"`,
          userEmail: member.user.email,
          userTimezone: member.user.timezone,
        }),
      ),
    );
  }

  private async spawnNextRecurrence(
    task: Task,
    workspaceId: string,
  ): Promise<void> {
    const rule = task.recurrenceRule as RecurrenceRule | null;
    if (!rule || !task.dueDate) return;

    const currentDue = new Date(task.dueDate);
    let nextDue: Date;

    if (rule === RecurrenceRule.DAILY) {
      nextDue = new Date(currentDue);
      nextDue.setDate(nextDue.getDate() + 1);
    } else if (rule === RecurrenceRule.WEEKLY) {
      nextDue = new Date(currentDue);
      nextDue.setDate(nextDue.getDate() + 7);
    } else {
      nextDue = new Date(currentDue);
      nextDue.setMonth(nextDue.getMonth() + 1);
    }

    const openStatusId =
      await this.taskStatuses.getDefaultOpenStatusId(workspaceId);

    await this.prisma.task.create({
      data: {
        workspaceId,
        title: task.title,
        description: task.description,
        dueDate: nextDue,
        dueTime: task.dueTime,
        priority: task.priority,
        status: openStatusId,
        recurrenceRule: rule,
        recurrenceParentId: task.id,
        sortOrder: task.sortOrder ?? 0,
      },
    });
  }

  async logFocus(
    workspaceId: string,
    id: string,
    userId: string,
    minutes: number,
  ): Promise<Task> {
    await this.findOne(workspaceId, id, userId);
    const updated = await this.prisma.task.update({
      where: { id },
      data: { focusMinutes: { increment: minutes } },
    });
    if (minutes > 0) {
      await this.analytics.logStat(workspaceId, userId, {
        focusMinutes: minutes,
      });
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

  /** Reorder tasks: accepts ordered array of ids, assigns sortOrder 0..n-1 */
  async reorder(
    workspaceId: string,
    userId: string,
    ids: string[],
  ): Promise<void> {
    await this.assertMember(workspaceId, userId);
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.task.update({
          where: { id, workspaceId },
          data: { sortOrder: index },
        }),
      ),
    );
  }

  async bulkUpdate(
    workspaceId: string,
    userId: string,
    dto: BulkTaskDto,
  ): Promise<{ affected: number }> {
    await this.assertMember(workspaceId, userId);

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

    const terminalIds = new Set(
      await this.taskStatuses.terminalStatusIds(workspaceId),
    );
    const alreadyDoneIds = new Set(
      tasks.filter((t) => terminalIds.has(t.status)).map((t) => t.id),
    );
    const toCompleteIds = validIds.filter((id) => !alreadyDoneIds.has(id));

    if (toCompleteIds.length > 0) {
      const terminalTarget =
        await this.taskStatuses.getFirstTerminalStatusId(workspaceId);
      await this.prisma.task.updateMany({
        where: { id: { in: toCompleteIds } },
        data: { status: terminalTarget, completedAt: new Date() },
      });
      await this.analytics.logStat(workspaceId, userId, {
        tasksCompleted: toCompleteIds.length,
      });
    }

    return { affected: toCompleteIds.length };
  }
}
