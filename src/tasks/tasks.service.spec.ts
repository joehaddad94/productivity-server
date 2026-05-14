import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Task } from '@prisma/client';
import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { TaskStatusesService } from '../task-statuses/task-statuses.service';
import { NotificationsService } from '../notifications/notifications.service';
import { membershipCache, membershipKey } from '../common/membership-cache';
import { RecurrenceRule } from './dto/create-task.dto';
import { BulkTaskAction } from './dto/bulk-task.dto';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: {
    workspaceMember: { findUnique: jest.Mock; findMany: jest.Mock };
    task: {
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let analytics: jest.Mocked<Pick<AnalyticsService, 'logStat'>>;
  let taskStatuses: jest.Mocked<
    Pick<
      TaskStatusesService,
      | 'getDefaultOpenStatusId'
      | 'assertStatusInWorkspace'
      | 'isTerminal'
      | 'terminalStatusIds'
      | 'getFirstTerminalStatusId'
    >
  >;
  let notifications: jest.Mocked<
    Pick<NotificationsService, 'createAndDeliver'>
  >;

  const WS = 'ws-1';
  const USER = 'user-1';
  const OPEN_STATUS = 'status-open';
  const DONE_STATUS = 'status-done';

  const makeTask = (overrides: Partial<Task> = {}): Task & { subtasks: Task[] } => ({
    id: 'task-1',
    workspaceId: WS,
    title: 'My Task',
    description: null,
    status: OPEN_STATUS,
    priority: null,
    dueDate: null,
    dueTime: null,
    sortOrder: 0,
    parentTaskId: null,
    recurrenceRule: null,
    recurrenceParentId: null,
    projectId: null,
    creatorId: null,
    completedAt: null,
    focusMinutes: 0,
    deletedAt: null,
    createdAt: new Date(),
    subtasks: [],
    ...overrides,
  });

  beforeEach(async () => {
    membershipCache.delete(membershipKey(USER, WS));

    const mockPrisma = {
      workspaceMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      task: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      taskAssignee: {
        findMany: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      taskActivity: {
        create: jest.fn().mockResolvedValue(undefined),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(),
    };

    const mockAnalytics = { logStat: jest.fn() };
    const mockTaskStatuses = {
      getDefaultOpenStatusId: jest.fn().mockResolvedValue(OPEN_STATUS),
      assertStatusInWorkspace: jest.fn().mockResolvedValue(undefined),
      isTerminal: jest.fn().mockResolvedValue(false),
      terminalStatusIds: jest.fn().mockResolvedValue([DONE_STATUS]),
      getFirstTerminalStatusId: jest.fn().mockResolvedValue(DONE_STATUS),
    };
    const mockNotifications = { createAndDeliver: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalyticsService, useValue: mockAnalytics },
        { provide: TaskStatusesService, useValue: mockTaskStatuses },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    prisma = module.get(PrismaService);
    analytics = module.get(AnalyticsService);
    taskStatuses = module.get(TaskStatusesService);
    notifications = module.get(NotificationsService);
    jest.clearAllMocks();

    // Default: user is a member with canSeeAllTasks=true (so visibility filter is empty)
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'm-1',
      role: 'member',
      canSeeAllTasks: true,
    });
    taskStatuses.getDefaultOpenStatusId.mockResolvedValue(OPEN_STATUS);
    taskStatuses.assertStatusInWorkspace.mockResolvedValue(undefined);
    taskStatuses.isTerminal.mockResolvedValue(false);
    taskStatuses.terminalStatusIds.mockResolvedValue([DONE_STATUS]);
    taskStatuses.getFirstTerminalStatusId.mockResolvedValue(DONE_STATUS);
  });

  describe('list', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.list(WS, USER, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns tasks and total with no filters', async () => {
      const task = makeTask();
      prisma.task.findMany.mockResolvedValue([task]);
      prisma.task.count.mockResolvedValue(1);

      const result = await service.list(WS, USER, {});

      expect(result.tasks).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('applies status filter', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);

      await service.list(WS, USER, { status: DONE_STATUS });

      const call = prisma.task.findMany.mock.calls[0][0] as {
        where: { status?: string };
      };
      expect(call.where.status).toBe(DONE_STATUS);
    });

    it('applies search filter with OR on title and description', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);

      await service.list(WS, USER, { search: 'urgent' });

      const call = prisma.task.findMany.mock.calls[0][0] as {
        where: { OR?: unknown[] };
      };
      expect(call.where.OR).toBeDefined();
    });

    it('applies dueDate range filters', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);

      await service.list(WS, USER, {
        dueBefore: '2026-06-01',
        dueAfter: '2026-05-01',
      });

      const call = prisma.task.findMany.mock.calls[0][0] as {
        where: { dueDate?: { lte?: Date; gte?: Date } };
      };
      expect(call.where.dueDate?.lte).toBeDefined();
      expect(call.where.dueDate?.gte).toBeDefined();
    });

    it('applies projectId filter', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);

      await service.list(WS, USER, { projectId: 'proj-1' });

      const call = prisma.task.findMany.mock.calls[0][0] as {
        where: { projectId?: string };
      };
      expect(call.where.projectId).toBe('proj-1');
    });

    it('applies default limit 50 and skip 0', async () => {
      prisma.task.findMany.mockResolvedValue([]);
      prisma.task.count.mockResolvedValue(0);

      await service.list(WS, USER, {});

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0 }),
      );
    });
  });

  describe('create', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.create(WS, USER, { title: 'Task' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates task with default open status and trimmed title', async () => {
      const task = makeTask();
      prisma.task.create.mockResolvedValue(task);

      const result = await service.create(WS, USER, {
        title: '  My Task  ',
      });

      expect(result).toEqual(task);
      expect(prisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: WS,
          title: 'My Task',
          status: OPEN_STATUS,
        }),
      });
    });

    it('uses provided status id', async () => {
      const task = makeTask({ status: DONE_STATUS });
      prisma.task.create.mockResolvedValue(task);
      taskStatuses.isTerminal.mockResolvedValue(true);

      await service.create(WS, USER, {
        title: 'Task',
        status: DONE_STATUS,
      });

      expect(prisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: DONE_STATUS,
          completedAt: expect.any(Date),
        }),
      });
    });

    it('sets completedAt when status is terminal', async () => {
      prisma.task.create.mockResolvedValue(makeTask({ status: DONE_STATUS }));
      taskStatuses.isTerminal.mockResolvedValue(true);

      await service.create(WS, USER, {
        title: 'Done Task',
        status: DONE_STATUS,
      });

      const callData = prisma.task.create.mock.calls[0][0].data as {
        completedAt?: Date;
      };
      expect(callData.completedAt).toBeInstanceOf(Date);
    });

    it('does not set completedAt for non-terminal status', async () => {
      prisma.task.create.mockResolvedValue(makeTask());
      taskStatuses.isTerminal.mockResolvedValue(false);

      await service.create(WS, USER, { title: 'Open Task' });

      const callData = prisma.task.create.mock.calls[0][0].data as {
        completedAt?: Date;
      };
      expect(callData.completedAt).toBeUndefined();
    });

    it('creates task with dueDate and recurrenceRule', async () => {
      prisma.task.create.mockResolvedValue(
        makeTask({ recurrenceRule: 'DAILY' as never }),
      );

      await service.create(WS, USER, {
        title: 'Recurring',
        dueDate: '2026-06-01',
        recurrenceRule: RecurrenceRule.DAILY,
      });

      expect(prisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          dueDate: expect.any(Date),
          recurrenceRule: RecurrenceRule.DAILY,
        }),
      });
    });
  });

  describe('findOne', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.findOne(WS, 'task-1', USER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns task when found', async () => {
      const task = makeTask();
      prisma.task.findFirst.mockResolvedValue(task);

      const result = await service.findOne(WS, 'task-1', USER);

      expect(result).toEqual(task);
      expect(prisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1', workspaceId: WS, deletedAt: null },
        }),
      );
    });

    it('throws NotFoundException when task not found', async () => {
      prisma.task.findFirst.mockResolvedValue(null);

      await expect(service.findOne(WS, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne(WS, 'missing', USER)).rejects.toThrow(
        'Task not found',
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when task not found', async () => {
      prisma.task.findFirst.mockResolvedValue(null);

      await expect(
        service.update(WS, 'missing', USER, { title: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('trims title when provided', async () => {
      const existing = makeTask();
      prisma.task.findFirst.mockResolvedValue(existing);
      prisma.task.update.mockResolvedValue({ ...existing, title: 'Updated' });

      await service.update(WS, 'task-1', USER, { title: '  Updated  ' });

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Updated' }),
        }),
      );
    });

    it('sets completedAt when status changes from open to terminal', async () => {
      const existing = makeTask({ status: OPEN_STATUS });
      prisma.task.findFirst.mockResolvedValue(existing);
      taskStatuses.isTerminal
        .mockResolvedValueOnce(false) // wasTerminal (existing)
        .mockResolvedValueOnce(true); // nowTerminal (new status)
      const updated = makeTask({ status: DONE_STATUS, completedAt: new Date() });
      prisma.task.update.mockResolvedValue(updated);
      prisma.task.updateMany.mockResolvedValue({ count: 0 });
      analytics.logStat.mockResolvedValue(undefined as never);
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue({
        id: USER,
        name: 'Jane',
        email: 'jane@example.com',
      });

      await service.update(WS, 'task-1', USER, { status: DONE_STATUS });

      const callData = prisma.task.update.mock.calls[0][0].data as {
        completedAt?: Date;
      };
      expect(callData.completedAt).toBeInstanceOf(Date);
    });

    it('clears completedAt when status changes from terminal to open', async () => {
      const existing = makeTask({ status: DONE_STATUS, completedAt: new Date() });
      prisma.task.findFirst.mockResolvedValue(existing);
      taskStatuses.isTerminal
        .mockResolvedValueOnce(true) // wasTerminal
        .mockResolvedValueOnce(false); // nowTerminal
      prisma.task.update.mockResolvedValue(makeTask({ status: OPEN_STATUS }));

      await service.update(WS, 'task-1', USER, { status: OPEN_STATUS });

      const callData = prisma.task.update.mock.calls[0][0].data as {
        completedAt?: null;
      };
      expect(callData.completedAt).toBeNull();
    });

    it('cascades completion to non-terminal subtasks', async () => {
      const existing = makeTask({ status: OPEN_STATUS });
      prisma.task.findFirst.mockResolvedValue(existing);
      taskStatuses.isTerminal
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      prisma.task.update.mockResolvedValue(
        makeTask({ status: DONE_STATUS, completedAt: new Date() }),
      );
      prisma.task.updateMany.mockResolvedValue({ count: 2 });
      analytics.logStat.mockResolvedValue(undefined as never);
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue({
        id: USER,
        name: 'Jane',
        email: 'j@example.com',
      });

      await service.update(WS, 'task-1', USER, { status: DONE_STATUS });

      expect(prisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ parentTaskId: 'task-1' }),
          data: { status: DONE_STATUS, completedAt: expect.any(Date) },
        }),
      );
    });

    it('logs analytics when completing a task', async () => {
      const existing = makeTask({ status: OPEN_STATUS });
      prisma.task.findFirst.mockResolvedValue(existing);
      taskStatuses.isTerminal
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      prisma.task.update.mockResolvedValue(
        makeTask({ status: DONE_STATUS, completedAt: new Date() }),
      );
      prisma.task.updateMany.mockResolvedValue({ count: 0 });
      analytics.logStat.mockResolvedValue(undefined as never);
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue({ id: USER, name: 'Jane' });

      await service.update(WS, 'task-1', USER, { status: DONE_STATUS });

      expect(analytics.logStat).toHaveBeenCalledWith(WS, USER, {
        tasksCompleted: 1,
      });
    });

    it('notifies other workspace members when completing a task', async () => {
      const existing = makeTask({ status: OPEN_STATUS });
      prisma.task.findFirst.mockResolvedValue(existing);
      taskStatuses.isTerminal
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      prisma.task.update.mockResolvedValue(
        makeTask({ status: DONE_STATUS, title: 'My Task', completedAt: new Date() }),
      );
      prisma.task.updateMany.mockResolvedValue({ count: 0 });
      analytics.logStat.mockResolvedValue(undefined as never);
      prisma.workspaceMember.findMany.mockResolvedValue([
        {
          userId: 'user-2',
          user: { email: 'other@example.com', timezone: 'UTC' },
        },
      ]);
      prisma.user.findUnique.mockResolvedValue({
        id: USER,
        name: 'Jane',
        email: 'jane@example.com',
      });
      notifications.createAndDeliver.mockResolvedValue(undefined);

      await service.update(WS, 'task-1', USER, { status: DONE_STATUS });

      expect(notifications.createAndDeliver).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-2',
          type: 'task_completed',
          body: expect.stringContaining('My Task'),
        }),
      );
    });

    it('spawns daily recurrence when completing a task with DAILY rule', async () => {
      const dueDate = new Date('2026-05-10');
      const existing = makeTask({
        status: OPEN_STATUS,
        dueDate,
        recurrenceRule: RecurrenceRule.DAILY as unknown as null,
      });
      prisma.task.findFirst.mockResolvedValue(existing);
      taskStatuses.isTerminal
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      prisma.task.update.mockResolvedValue(
        makeTask({ status: DONE_STATUS, completedAt: new Date() }),
      );
      prisma.task.updateMany.mockResolvedValue({ count: 0 });
      analytics.logStat.mockResolvedValue(undefined as never);
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue({ id: USER });
      taskStatuses.getDefaultOpenStatusId.mockResolvedValue(OPEN_STATUS);
      prisma.task.create.mockResolvedValue(makeTask());

      await service.update(WS, 'task-1', USER, { status: DONE_STATUS });

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            recurrenceRule: RecurrenceRule.DAILY,
            dueDate: new Date('2026-05-11'),
          }),
        }),
      );
    });

    it('spawns weekly recurrence when completing a task with WEEKLY rule', async () => {
      const dueDate = new Date('2026-05-10');
      const existing = makeTask({
        status: OPEN_STATUS,
        dueDate,
        recurrenceRule: RecurrenceRule.WEEKLY as unknown as null,
      });
      prisma.task.findFirst.mockResolvedValue(existing);
      taskStatuses.isTerminal
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      prisma.task.update.mockResolvedValue(
        makeTask({ status: DONE_STATUS, completedAt: new Date() }),
      );
      prisma.task.updateMany.mockResolvedValue({ count: 0 });
      analytics.logStat.mockResolvedValue(undefined as never);
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue({ id: USER });
      taskStatuses.getDefaultOpenStatusId.mockResolvedValue(OPEN_STATUS);
      prisma.task.create.mockResolvedValue(makeTask());

      await service.update(WS, 'task-1', USER, { status: DONE_STATUS });

      const callData = prisma.task.create.mock.calls[0][0].data as {
        dueDate: Date;
      };
      expect(callData.dueDate).toEqual(new Date('2026-05-17'));
    });

    it('does not spawn recurrence when task has no dueDate', async () => {
      const existing = makeTask({
        status: OPEN_STATUS,
        dueDate: null,
        recurrenceRule: RecurrenceRule.DAILY as unknown as null,
      });
      prisma.task.findFirst.mockResolvedValue(existing);
      taskStatuses.isTerminal
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      prisma.task.update.mockResolvedValue(
        makeTask({ status: DONE_STATUS, completedAt: new Date() }),
      );
      prisma.task.updateMany.mockResolvedValue({ count: 0 });
      analytics.logStat.mockResolvedValue(undefined as never);
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue({ id: USER });

      await service.update(WS, 'task-1', USER, { status: DONE_STATUS });

      expect(prisma.task.create).not.toHaveBeenCalled();
    });

    it('does not cascade or log analytics when status is not changed', async () => {
      const existing = makeTask({ status: OPEN_STATUS });
      prisma.task.findFirst.mockResolvedValue(existing);
      prisma.task.update.mockResolvedValue(makeTask({ title: 'Updated' }));

      await service.update(WS, 'task-1', USER, { title: 'Updated' });

      expect(taskStatuses.isTerminal).not.toHaveBeenCalled();
      expect(prisma.task.updateMany).not.toHaveBeenCalled();
      expect(analytics.logStat).not.toHaveBeenCalled();
    });
  });

  describe('logFocus', () => {
    it('throws NotFoundException when task not found', async () => {
      prisma.task.findFirst.mockResolvedValue(null);

      await expect(service.logFocus(WS, 'missing', USER, 25)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('increments focusMinutes on the task', async () => {
      prisma.task.findFirst.mockResolvedValue(makeTask());
      prisma.task.update.mockResolvedValue(makeTask({ focusMinutes: 25 }));

      await service.logFocus(WS, 'task-1', USER, 25);

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { focusMinutes: { increment: 25 } },
      });
    });

    it('logs analytics for positive minutes', async () => {
      prisma.task.findFirst.mockResolvedValue(makeTask());
      prisma.task.update.mockResolvedValue(makeTask({ focusMinutes: 25 }));
      analytics.logStat.mockResolvedValue(undefined as never);

      await service.logFocus(WS, 'task-1', USER, 25);

      expect(analytics.logStat).toHaveBeenCalledWith(WS, USER, {
        focusMinutes: 25,
      });
    });

    it('does not log analytics when minutes is 0', async () => {
      prisma.task.findFirst.mockResolvedValue(makeTask());
      prisma.task.update.mockResolvedValue(makeTask());

      await service.logFocus(WS, 'task-1', USER, 0);

      expect(analytics.logStat).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when task not found', async () => {
      prisma.task.findFirst.mockResolvedValue(null);

      await expect(service.remove(WS, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes the task by setting deletedAt', async () => {
      prisma.task.findFirst.mockResolvedValue(makeTask());
      prisma.task.update.mockResolvedValue(makeTask({ deletedAt: new Date() }));

      await service.remove(WS, 'task-1', USER);

      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });

  describe('reorder', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.reorder(WS, USER, ['task-1', 'task-2']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('calls $transaction with sortOrder updates for each id', async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: 'task-a' },
        { id: 'task-b' },
        { id: 'task-c' },
      ]);
      prisma.$transaction.mockResolvedValue([]);

      await service.reorder(WS, USER, ['task-a', 'task-b', 'task-c']);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('bulkUpdate', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.bulkUpdate(WS, USER, {
          ids: ['task-1'],
          action: BulkTaskAction.DELETE,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns { affected: 0 } when no matching tasks found', async () => {
      prisma.task.findMany.mockResolvedValue([]);

      const result = await service.bulkUpdate(WS, USER, {
        ids: ['non-existent'],
        action: BulkTaskAction.DELETE,
      });

      expect(result).toEqual({ affected: 0 });
      expect(prisma.task.updateMany).not.toHaveBeenCalled();
    });

    it('soft-deletes tasks on DELETE action', async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: 'task-1', status: OPEN_STATUS },
        { id: 'task-2', status: OPEN_STATUS },
      ]);
      prisma.task.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.bulkUpdate(WS, USER, {
        ids: ['task-1', 'task-2'],
        action: BulkTaskAction.DELETE,
      });

      expect(result).toEqual({ affected: 2 });
      expect(prisma.task.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['task-1', 'task-2'] } },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('completes only non-terminal tasks on COMPLETE action', async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: 'task-1', status: OPEN_STATUS },
        { id: 'task-2', status: DONE_STATUS }, // already done
      ]);
      taskStatuses.terminalStatusIds.mockResolvedValue([DONE_STATUS]);
      taskStatuses.getFirstTerminalStatusId.mockResolvedValue(DONE_STATUS);
      prisma.task.updateMany.mockResolvedValue({ count: 1 });
      analytics.logStat.mockResolvedValue(undefined as never);

      const result = await service.bulkUpdate(WS, USER, {
        ids: ['task-1', 'task-2'],
        action: BulkTaskAction.COMPLETE,
      });

      expect(result).toEqual({ affected: 1 });
      expect(prisma.task.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['task-1'] } },
        data: {
          status: DONE_STATUS,
          completedAt: expect.any(Date),
        },
      });
      expect(analytics.logStat).toHaveBeenCalledWith(WS, USER, {
        tasksCompleted: 1,
      });
    });

    it('returns { affected: 0 } when all tasks are already completed', async () => {
      prisma.task.findMany.mockResolvedValue([
        { id: 'task-1', status: DONE_STATUS },
      ]);
      taskStatuses.terminalStatusIds.mockResolvedValue([DONE_STATUS]);

      const result = await service.bulkUpdate(WS, USER, {
        ids: ['task-1'],
        action: BulkTaskAction.COMPLETE,
      });

      expect(result).toEqual({ affected: 0 });
      expect(prisma.task.updateMany).not.toHaveBeenCalled();
      expect(analytics.logStat).not.toHaveBeenCalled();
    });
  });
});
