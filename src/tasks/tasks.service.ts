import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertMember } from '../common/assert-member';
import { AnalyticsService } from '../analytics/analytics.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Prisma, Task } from '@prisma/client';
import { CreateTaskDto, RecurrenceRule } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { BulkTaskDto, BulkTaskAction } from './dto/bulk-task.dto';
import { TaskStatusesService } from '../task-statuses/task-statuses.service';
import { buildTaskVisibilityWhere } from './task-visibility';

const ASSIGNEE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
} as const;

const ASSIGNEE_INCLUDE = {
  user: { select: ASSIGNEE_USER_SELECT },
} as const;

type AssigneeWithUser = Prisma.TaskAssigneeGetPayload<{
  include: typeof ASSIGNEE_INCLUDE;
}>;

type TaskWithDetails = Task & {
  subtasks: (Task & { assignees: AssigneeWithUser[] })[];
  assignees: AssigneeWithUser[];
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly taskStatuses: TaskStatusesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async list(
    workspaceId: string,
    userId: string,
    query: QueryTaskDto,
  ): Promise<{ tasks: TaskWithDetails[]; total: number }> {
    const { role, canSeeAllTasks } = await assertMember(
      this.prisma,
      workspaceId,
      userId,
    );
    const visibility = buildTaskVisibilityWhere(userId, role, canSeeAllTasks);

    const where: Prisma.TaskWhereInput = {
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
      ...(Object.keys(visibility).length > 0 ? { AND: [visibility] } : {}),
    };

    const limit = query.limit ?? 50;
    const skip = query.skip ?? 0;

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: {
          subtasks: {
            where: { deletedAt: null, ...visibility },
            orderBy: { createdAt: 'asc' },
            include: { assignees: { include: ASSIGNEE_INCLUDE } },
          },
          assignees: { include: ASSIGNEE_INCLUDE },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        take: limit,
        skip,
      }),
      this.prisma.task.count({ where }),
    ]);

    return { tasks: tasks as TaskWithDetails[], total };
  }

  async create(
    workspaceId: string,
    userId: string,
    dto: CreateTaskDto,
  ): Promise<Task> {
    const { role } = await assertMember(this.prisma, workspaceId, userId);

    const statusId =
      dto.status ??
      (await this.taskStatuses.getDefaultOpenStatusId(workspaceId));
    await this.taskStatuses.assertStatusInWorkspace(workspaceId, statusId);
    const terminal = await this.taskStatuses.isTerminal(workspaceId, statusId);

    // Build initial assignee list:
    //   - subtask → inherit parent's assignees (preserve assignedById)
    //   - explicit assigneeIds → owner/admin only, no self-assignment
    let assigneeRows: { userId: string; assignedById: string }[] = [];

    if (dto.parentTaskId) {
      const parent = await this.prisma.task.findFirst({
        where: { id: dto.parentTaskId, workspaceId, deletedAt: null },
        include: { assignees: true },
      });
      if (!parent) throw new NotFoundException('Parent task not found');
      assigneeRows = parent.assignees.map((a) => ({
        userId: a.userId,
        assignedById: a.assignedById,
      }));
    }

    if (dto.assigneeIds && dto.assigneeIds.length > 0) {
      if (role !== 'owner' && role !== 'admin') {
        throw new ForbiddenException(
          'Only owner or admin can assign tasks',
        );
      }
      if (dto.assigneeIds.includes(userId)) {
        throw new BadRequestException('Cannot assign a task to yourself');
      }
      await this.assertUsersInWorkspace(workspaceId, dto.assigneeIds);
      const seen = new Set(assigneeRows.map((r) => r.userId));
      for (const uid of dto.assigneeIds) {
        if (!seen.has(uid)) {
          assigneeRows.push({ userId: uid, assignedById: userId });
          seen.add(uid);
        }
      }
    }

    const created = await this.prisma.task.create({
      data: {
        workspaceId,
        creatorId: userId,
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
        ...(assigneeRows.length > 0
          ? { assignees: { createMany: { data: assigneeRows } } }
          : {}),
      },
    });

    // Fire-and-forget: log creation activity + assignment notifications
    void this.logActivity(created.id, userId, 'created');

    if (assigneeRows.length > 0) {
      const recipientIds = assigneeRows
        .map((r) => r.userId)
        .filter((uid) => uid !== userId);
      if (recipientIds.length > 0) {
        void this.notifyAssigned(workspaceId, created.id, created.title, recipientIds);
      }
      for (const row of assigneeRows) {
        void this.logActivity(created.id, userId, 'assigned', {
          assigneeId: row.userId,
        });
      }
    }

    return created;
  }

  /**
   * Send a "task assigned to you" notification to each recipient.
   * Skips silently on per-user delivery failure so one bad subscription
   * doesn't break the whole assignment call.
   */
  private async notifyAssigned(
    workspaceId: string,
    taskId: string,
    taskTitle: string,
    recipientUserIds: string[],
  ): Promise<void> {
    if (recipientUserIds.length === 0) return;

    const users = await this.prisma.user.findMany({
      where: { id: { in: recipientUserIds } },
      select: { id: true, email: true, timezone: true },
    });

    await Promise.all(
      users.map((u) =>
        this.notificationsService
          .createAndDeliver({
            userId: u.id,
            workspaceId,
            taskId,
            type: 'task_assigned',
            title: 'Task assigned',
            body: `"${taskTitle}" has been assigned to you`,
            userEmail: u.email,
            userTimezone: u.timezone,
            url: '/tasks',
          })
          .catch(() => undefined),
      ),
    );
  }

  private async assertUsersInWorkspace(
    workspaceId: string,
    userIds: string[],
  ): Promise<void> {
    const count = await this.prisma.workspaceMember.count({
      where: { workspaceId, userId: { in: userIds } },
    });
    if (count !== userIds.length) {
      throw new BadRequestException(
        'One or more users are not members of this workspace',
      );
    }
  }

  async addAssignees(
    workspaceId: string,
    taskId: string,
    requesterId: string,
    userIds: string[],
  ): Promise<TaskWithDetails> {
    const { role } = await assertMember(
      this.prisma,
      workspaceId,
      requesterId,
    );
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException('Only owner or admin can assign tasks');
    }
    if (userIds.includes(requesterId)) {
      throw new BadRequestException('Cannot assign a task to yourself');
    }
    await this.assertUsersInWorkspace(workspaceId, userIds);

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
    });
    if (!task) throw new NotFoundException('Task not found');

    // Figure out which userIds are actually new — only those get notified
    const existing = await this.prisma.taskAssignee.findMany({
      where: { taskId, userId: { in: userIds } },
      select: { userId: true },
    });
    const existingIds = new Set(existing.map((e) => e.userId));
    const newAssigneeIds = userIds.filter((uid) => !existingIds.has(uid));

    await this.prisma.taskAssignee.createMany({
      data: userIds.map((uid) => ({
        taskId,
        userId: uid,
        assignedById: requesterId,
      })),
      skipDuplicates: true,
    });

    if (newAssigneeIds.length > 0) {
      void this.notifyAssigned(workspaceId, taskId, task.title, newAssigneeIds);
      for (const uid of newAssigneeIds) {
        void this.logActivity(taskId, requesterId, 'assigned', { assigneeId: uid });
      }
    }

    return this.fetchTaskWithDetails(workspaceId, taskId);
  }

  async removeAssignee(
    workspaceId: string,
    taskId: string,
    requesterId: string,
    targetUserId: string,
  ): Promise<TaskWithDetails> {
    const { role } = await assertMember(
      this.prisma,
      workspaceId,
      requesterId,
    );
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException(
        'Only owner or admin can remove assignees',
      );
    }

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
    });
    if (!task) throw new NotFoundException('Task not found');

    await this.prisma.taskAssignee.deleteMany({
      where: { taskId, userId: targetUserId },
    });

    void this.logActivity(taskId, requesterId, 'unassigned', {
      assigneeId: targetUserId,
    });

    return this.fetchTaskWithDetails(workspaceId, taskId);
  }

  private logActivity(
    taskId: string,
    userId: string,
    type: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.prisma.taskActivity
      .create({ data: { taskId, userId, type, metadata: (metadata as any) ?? undefined } })
      .then(() => undefined)
      .catch(() => undefined); // never block the primary operation
  }

  private async fetchTaskWithDetails(
    workspaceId: string,
    taskId: string,
  ): Promise<TaskWithDetails> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
      include: {
        subtasks: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: { assignees: { include: ASSIGNEE_INCLUDE } },
        },
        assignees: { include: ASSIGNEE_INCLUDE },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task as TaskWithDetails;
  }

  async findOne(
    workspaceId: string,
    id: string,
    userId: string,
  ): Promise<TaskWithDetails> {
    const { role, canSeeAllTasks } = await assertMember(
      this.prisma,
      workspaceId,
      userId,
    );
    const visibility = buildTaskVisibilityWhere(userId, role, canSeeAllTasks);

    const task = await this.prisma.task.findFirst({
      where: { id, workspaceId, deletedAt: null, ...visibility },
      include: {
        subtasks: {
          where: { deletedAt: null, ...visibility },
          orderBy: { createdAt: 'asc' },
          include: { assignees: { include: ASSIGNEE_INCLUDE } },
        },
        assignees: { include: ASSIGNEE_INCLUDE },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task as TaskWithDetails;
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

    // Log field changes as activity (fire-and-forget)
    if (dto.status !== undefined && dto.status !== existing.status) {
      void this.logActivity(id, userId, 'status_changed', {
        from: existing.status,
        to: dto.status,
      });
    }
    if (dto.dueDate !== undefined) {
      void this.logActivity(id, userId, 'due_date_changed', {
        from: existing.dueDate?.toISOString().slice(0, 10) ?? null,
        to: dto.dueDate ?? null,
      });
    }
    if (dto.priority !== undefined && dto.priority !== existing.priority) {
      void this.logActivity(id, userId, 'priority_changed', {
        from: existing.priority ?? null,
        to: dto.priority,
      });
    }

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
        creatorId: task.creatorId,
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
    // Lightweight membership + existence check — no need for the full
    // findOne (which fetches subtasks/assignees and runs visibility filters).
    await assertMember(this.prisma, workspaceId, userId);
    const exists = await this.prisma.task.findFirst({
      where: { id, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Task not found');

    // Parallelize the update and the analytics upsert.
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    const [updated] = await Promise.all([
      this.prisma.task.update({
        where: { id },
        data: { focusMinutes: { increment: minutes } },
      }),
      minutes > 0
        ? this.prisma.dailyStat.upsert({
            where: { workspaceId_userId_date: { workspaceId, userId, date } },
            update: { focusMinutes: { increment: minutes } },
            create: {
              workspaceId,
              userId,
              date,
              focusMinutes: minutes,
              tasksCompleted: 0,
            },
          })
        : Promise.resolve(null),
    ]);
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
    const { role, canSeeAllTasks } = await assertMember(
      this.prisma,
      workspaceId,
      userId,
    );
    const visibility = buildTaskVisibilityWhere(userId, role, canSeeAllTasks);

    // Only reorder tasks the user can actually see
    const visibleTasks = await this.prisma.task.findMany({
      where: { id: { in: ids }, workspaceId, deletedAt: null, ...visibility },
      select: { id: true },
    });
    const visibleIds = new Set(visibleTasks.map((t) => t.id));
    const orderedVisibleIds = ids.filter((id) => visibleIds.has(id));

    await this.prisma.$transaction(
      orderedVisibleIds.map((id, index) =>
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
    const { role, canSeeAllTasks } = await assertMember(
      this.prisma,
      workspaceId,
      userId,
    );
    const visibility = buildTaskVisibilityWhere(userId, role, canSeeAllTasks);

    const tasks = await this.prisma.task.findMany({
      where: {
        id: { in: dto.ids },
        workspaceId,
        deletedAt: null,
        ...visibility,
      },
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
