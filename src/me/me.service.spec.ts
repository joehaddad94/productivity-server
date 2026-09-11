import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MeService } from './me.service';
import { PrismaService } from '../prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import { MeTasksLens } from './dto/query-me-tasks.dto';

describe('MeService', () => {
  let service: MeService;
  let prisma: {
    workspaceMember: { findMany: jest.Mock; findFirst: jest.Mock };
    task: { findMany: jest.Mock; count: jest.Mock };
    workspaceTaskStatus: { findMany: jest.Mock };
  };
  let tasks: { create: jest.Mock };

  const USER = 'user-1';
  const TEAM_WS = 'ws-team';
  const PERSONAL_WS = 'ws-personal';
  const OPEN_ID = 'status-open-id';

  beforeEach(async () => {
    prisma = {
      workspaceMember: { findMany: jest.fn(), findFirst: jest.fn() },
      task: { findMany: jest.fn(), count: jest.fn() },
      workspaceTaskStatus: { findMany: jest.fn() },
    };
    tasks = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeService,
        { provide: PrismaService, useValue: prisma },
        { provide: TasksService, useValue: tasks },
      ],
    }).compile();

    service = module.get(MeService);
  });

  it('returns empty without querying tasks when the user has no memberships', async () => {
    prisma.workspaceMember.findMany.mockResolvedValue([]);

    const result = await service.getTasks(USER, {});

    expect(result).toEqual({ tasks: [], total: 0 });
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('builds a predicate: assignee anywhere OR creator in a personal workspace', async () => {
    prisma.workspaceMember.findMany.mockResolvedValue([
      { workspaceId: TEAM_WS, workspace: { isPersonal: false } },
      { workspaceId: PERSONAL_WS, workspace: { isPersonal: true } },
    ]);
    prisma.task.findMany.mockResolvedValue([]);
    prisma.task.count.mockResolvedValue(0);

    await service.getTasks(USER, {});

    const where = prisma.task.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.workspaceId).toEqual({ in: [TEAM_WS, PERSONAL_WS] });
    expect(where.OR).toEqual([
      { assignees: { some: { userId: USER } } },
      { workspaceId: { in: [PERSONAL_WS] }, creatorId: USER },
    ]);
  });

  it('omits the personal-creator branch when the user has no personal workspace', async () => {
    prisma.workspaceMember.findMany.mockResolvedValue([
      { workspaceId: TEAM_WS, workspace: { isPersonal: false } },
    ]);
    prisma.task.findMany.mockResolvedValue([]);
    prisma.task.count.mockResolvedValue(0);

    await service.getTasks(USER, {});

    const where = prisma.task.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ assignees: { some: { userId: USER } } }]);
  });

  it('restricts the calendar lens to dated tasks', async () => {
    prisma.workspaceMember.findMany.mockResolvedValue([
      { workspaceId: TEAM_WS, workspace: { isPersonal: false } },
    ]);
    prisma.task.findMany.mockResolvedValue([]);
    prisma.task.count.mockResolvedValue(0);

    await service.getTasks(USER, { lens: MeTasksLens.Calendar });

    const where = prisma.task.findMany.mock.calls[0][0].where;
    expect(where.dueDate).toEqual({ not: null });
  });

  it('enriches each task with workspace, status name/color, and canonical bucket', async () => {
    prisma.workspaceMember.findMany.mockResolvedValue([
      { workspaceId: TEAM_WS, workspace: { isPersonal: false } },
    ]);
    prisma.task.findMany.mockResolvedValue([
      {
        id: 't1',
        title: 'By id',
        description: null,
        dueDate: null,
        dueTime: null,
        priority: null,
        status: OPEN_ID,
        completedAt: null,
        parentTaskId: null,
        createdAt: new Date('2026-07-01T00:00:00Z'),
        workspaceId: TEAM_WS,
        workspace: { id: TEAM_WS, name: 'Team', isPersonal: false },
        project: null,
        assignees: [],
      },
      {
        id: 't2',
        title: 'Legacy key',
        description: null,
        dueDate: null,
        dueTime: null,
        priority: null,
        status: 'completed', // legacy bare key, no matching status row
        completedAt: new Date('2026-07-02T00:00:00Z'),
        parentTaskId: null,
        createdAt: new Date('2026-07-01T00:00:00Z'),
        workspaceId: TEAM_WS,
        workspace: { id: TEAM_WS, name: 'Team', isPersonal: false },
        project: null,
        assignees: [],
      },
    ]);
    prisma.task.count.mockResolvedValue(2);
    prisma.workspaceTaskStatus.findMany.mockResolvedValue([
      {
        id: OPEN_ID,
        key: 'pending',
        isTerminal: false,
        name: 'Pending',
        color: '#abc',
      },
    ]);

    const { tasks, total } = await service.getTasks(USER, {});

    expect(total).toBe(2);
    expect(tasks[0]).toMatchObject({
      id: 't1',
      statusName: 'Pending',
      statusColor: '#abc',
      canonicalBucket: 'open',
    });
    // legacy bare-key row: no status row, mapped by key, null name/color
    expect(tasks[1]).toMatchObject({
      id: 't2',
      statusName: null,
      statusColor: null,
      canonicalBucket: 'done',
    });
  });

  describe('quickAddTask', () => {
    it('defaults to the personal workspace and self-assigns', async () => {
      prisma.workspaceMember.findFirst.mockResolvedValue({
        workspaceId: PERSONAL_WS,
      });
      const created = { id: 't-new' };
      tasks.create.mockResolvedValue(created);

      const result = await service.quickAddTask(USER, { title: 'Buy milk' });

      expect(result).toBe(created);
      expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: { userId: USER, workspace: { isPersonal: true, deletedAt: null } },
        select: { workspaceId: true },
      });
      expect(tasks.create).toHaveBeenCalledWith(
        PERSONAL_WS,
        USER,
        expect.objectContaining({ title: 'Buy milk', assigneeIds: [USER] }),
      );
    });

    it('uses the explicit workspace when provided (no personal lookup)', async () => {
      const created = { id: 't-new' };
      tasks.create.mockResolvedValue(created);

      await service.quickAddTask(USER, { title: 'Team task', workspaceId: TEAM_WS });

      expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
      expect(tasks.create).toHaveBeenCalledWith(
        TEAM_WS,
        USER,
        expect.objectContaining({ assigneeIds: [USER] }),
      );
    });

    it('throws when the user has no personal workspace and none is given', async () => {
      prisma.workspaceMember.findFirst.mockResolvedValue(null);

      await expect(
        service.quickAddTask(USER, { title: 'Orphan' }),
      ).rejects.toThrow(BadRequestException);
      expect(tasks.create).not.toHaveBeenCalled();
    });
  });
});
