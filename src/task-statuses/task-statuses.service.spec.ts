import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceTaskStatus } from '@prisma/client';
import { TaskStatusesService } from './task-statuses.service';
import { PrismaService } from '../prisma/prisma.service';
import { membershipCache, membershipKey } from '../common/membership-cache';

describe('TaskStatusesService', () => {
  let service: TaskStatusesService;
  let prisma: {
    workspaceMember: { findUnique: jest.Mock };
    workspaceTaskStatus: {
      count: jest.Mock;
      createMany: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      aggregate: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    task: {
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const WS = 'ws-1';
  const USER = 'user-1';

  const now = new Date();

  const makeStatus = (
    overrides: Partial<WorkspaceTaskStatus> = {},
  ): WorkspaceTaskStatus => ({
    id: 'status-1',
    workspaceId: WS,
    key: null,
    name: 'Pending',
    sortOrder: 0,
    isTerminal: false,
    color: null,
    archivedAt: null,
    createdAt: now,
    ...overrides,
  });

  const openStatus = makeStatus({ id: 'open-1', name: 'Pending', isTerminal: false });
  const terminalStatus = makeStatus({
    id: 'done-1',
    name: 'Completed',
    isTerminal: true,
    sortOrder: 2,
  });

  beforeEach(async () => {
    membershipCache.delete(membershipKey(USER, WS));

    const mockPrisma = {
      workspaceMember: { findUnique: jest.fn() },
      workspaceTaskStatus: {
        count: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      task: {
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskStatusesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TaskStatusesService>(TaskStatusesService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('seedDefaultsForWorkspace', () => {
    it('does nothing when statuses already exist', async () => {
      prisma.workspaceTaskStatus.count.mockResolvedValue(3);

      await service.seedDefaultsForWorkspace(WS);

      expect(prisma.workspaceTaskStatus.createMany).not.toHaveBeenCalled();
    });

    it('creates 3 default statuses when none exist', async () => {
      prisma.workspaceTaskStatus.count.mockResolvedValue(0);
      prisma.workspaceTaskStatus.createMany.mockResolvedValue({ count: 3 });

      await service.seedDefaultsForWorkspace(WS);

      expect(prisma.workspaceTaskStatus.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ key: 'pending', isTerminal: false }),
          expect.objectContaining({ key: 'in_progress', isTerminal: false }),
          expect.objectContaining({ key: 'completed', isTerminal: true }),
        ]),
      });
    });
  });

  describe('list', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.list(WS, USER)).rejects.toThrow(ForbiddenException);
    });

    it('seeds defaults and returns statuses in API shape', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.count.mockResolvedValue(2);
      prisma.workspaceTaskStatus.findMany.mockResolvedValue([
        openStatus,
        terminalStatus,
      ]);

      const result = await service.list(WS, USER);

      expect(result.statuses).toHaveLength(2);
      expect(result.statuses[0]).toMatchObject({
        id: 'open-1',
        name: 'Pending',
        isTerminal: false,
        archivedAt: null,
      });
      expect(typeof result.statuses[0].createdAt).toBe('string');
    });
  });

  describe('findById', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.findById(WS, 'status-1', USER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns status when found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(openStatus);

      const result = await service.findById(WS, 'open-1', USER);

      expect(result).toEqual(openStatus);
    });

    it('throws NotFoundException when status not found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(null);

      await expect(service.findById(WS, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('isTerminal', () => {
    it('returns true for a terminal status', async () => {
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue({
        isTerminal: true,
      });

      const result = await service.isTerminal(WS, 'done-1');

      expect(result).toBe(true);
    });

    it('returns false for a non-terminal status', async () => {
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue({
        isTerminal: false,
      });

      const result = await service.isTerminal(WS, 'open-1');

      expect(result).toBe(false);
    });

    it('returns false when status is not found', async () => {
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(null);

      const result = await service.isTerminal(WS, 'missing');

      expect(result).toBe(false);
    });
  });

  describe('getDefaultOpenStatusId', () => {
    it('seeds defaults and returns the first non-terminal status id', async () => {
      prisma.workspaceTaskStatus.count.mockResolvedValue(3);
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue({ id: 'open-1' });

      const result = await service.getDefaultOpenStatusId(WS);

      expect(result).toBe('open-1');
    });

    it('throws BadRequestException when no open status configured', async () => {
      prisma.workspaceTaskStatus.count.mockResolvedValue(3);
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(null);

      await expect(service.getDefaultOpenStatusId(WS)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getFirstTerminalStatusId', () => {
    it('returns the first terminal status id', async () => {
      prisma.workspaceTaskStatus.count.mockResolvedValue(3);
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue({ id: 'done-1' });

      const result = await service.getFirstTerminalStatusId(WS);

      expect(result).toBe('done-1');
    });

    it('throws BadRequestException when no terminal status configured', async () => {
      prisma.workspaceTaskStatus.count.mockResolvedValue(3);
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(null);

      await expect(service.getFirstTerminalStatusId(WS)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('assertStatusInWorkspace', () => {
    it('passes silently when status exists in workspace', async () => {
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue({ id: 'open-1' });

      await expect(
        service.assertStatusInWorkspace(WS, 'open-1'),
      ).resolves.toBeUndefined();
    });

    it('throws BadRequestException when status not in workspace', async () => {
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(null);

      await expect(
        service.assertStatusInWorkspace(WS, 'invalid'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.assertStatusInWorkspace(WS, 'invalid'),
      ).rejects.toThrow('Invalid task status for this workspace');
    });
  });

  describe('create', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.create(WS, USER, { name: 'New Status' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates status with sortOrder from max+1', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.aggregate.mockResolvedValue({
        _max: { sortOrder: 2 },
      });
      prisma.workspaceTaskStatus.create.mockResolvedValue({
        ...openStatus,
        id: 'new-1',
        name: 'Review',
        sortOrder: 3,
      });

      const result = await service.create(WS, USER, { name: '  Review  ' });

      expect(result.status.name).toBe('Review');
      expect(prisma.workspaceTaskStatus.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Review',
          sortOrder: 3,
          isTerminal: false,
        }),
      });
    });

    it('uses provided sortOrder instead of max+1', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.aggregate.mockResolvedValue({
        _max: { sortOrder: 5 },
      });
      prisma.workspaceTaskStatus.create.mockResolvedValue({
        ...openStatus,
        sortOrder: 1,
      });

      await service.create(WS, USER, { name: 'Custom', sortOrder: 1 });

      expect(prisma.workspaceTaskStatus.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sortOrder: 1 }),
      });
    });

    it('creates terminal status when isTerminal is true', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.aggregate.mockResolvedValue({
        _max: { sortOrder: 0 },
      });
      prisma.workspaceTaskStatus.create.mockResolvedValue({
        ...terminalStatus,
      });

      await service.create(WS, USER, { name: 'Done', isTerminal: true });

      expect(prisma.workspaceTaskStatus.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isTerminal: true }),
      });
    });
  });

  describe('update', () => {
    it('throws NotFoundException when status not found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(null);

      await expect(
        service.update(WS, 'missing', USER, { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when removing last terminal status', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(terminalStatus);
      prisma.workspaceTaskStatus.count.mockResolvedValue(0);

      await expect(
        service.update(WS, 'done-1', USER, { isTerminal: false }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update(WS, 'done-1', USER, { isTerminal: false }),
      ).rejects.toThrow('at least one done-like status');
    });

    it('throws BadRequestException when removing last open status', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(openStatus);
      prisma.workspaceTaskStatus.count.mockResolvedValue(0);

      await expect(
        service.update(WS, 'open-1', USER, { isTerminal: true }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.update(WS, 'open-1', USER, { isTerminal: true }),
      ).rejects.toThrow('at least one non-terminal status');
    });

    it('updates name and sortOrder when no isTerminal change', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(openStatus);
      prisma.workspaceTaskStatus.update.mockResolvedValue({
        ...openStatus,
        name: 'In Review',
        sortOrder: 1,
      });

      const result = await service.update(WS, 'open-1', USER, {
        name: '  In Review  ',
        sortOrder: 1,
      });

      expect(result.status.name).toBe('In Review');
      expect(prisma.workspaceTaskStatus.update).toHaveBeenCalledWith({
        where: { id: 'open-1' },
        data: expect.objectContaining({ name: 'In Review', sortOrder: 1 }),
      });
    });

    it('allows changing isTerminal when other statuses exist of that type', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      // Making an open status terminal — need at least one other open
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(openStatus);
      prisma.workspaceTaskStatus.count.mockResolvedValue(1); // 1 other open remains
      prisma.workspaceTaskStatus.update.mockResolvedValue({
        ...openStatus,
        isTerminal: true,
      });

      await expect(
        service.update(WS, 'open-1', USER, { isTerminal: true }),
      ).resolves.toBeDefined();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when status not found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(null);

      await expect(service.remove(WS, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when deleting the only terminal status', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(terminalStatus);
      prisma.workspaceTaskStatus.count
        .mockResolvedValueOnce(1) // terminalCount = 1
        .mockResolvedValueOnce(2); // openCount = 2

      await expect(service.remove(WS, 'done-1', USER)).rejects.toThrow(
        'Cannot delete the only done-like status',
      );
    });

    it('throws BadRequestException when deleting the only open status', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(openStatus);
      prisma.workspaceTaskStatus.count
        .mockResolvedValueOnce(2) // terminalCount = 2
        .mockResolvedValueOnce(1); // openCount = 1

      await expect(service.remove(WS, 'open-1', USER)).rejects.toThrow(
        'Cannot delete the only open status',
      );
    });

    it('deletes status directly when no tasks use it', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(openStatus);
      prisma.workspaceTaskStatus.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(2);
      prisma.task.count.mockResolvedValue(0);
      prisma.workspaceTaskStatus.delete.mockResolvedValue(openStatus);

      await service.remove(WS, 'open-1', USER);

      expect(prisma.task.updateMany).not.toHaveBeenCalled();
      expect(prisma.workspaceTaskStatus.delete).toHaveBeenCalledWith({
        where: { id: 'open-1' },
      });
    });

    it('throws BadRequestException when tasks exist and no replacement provided', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(openStatus);
      prisma.workspaceTaskStatus.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(2);
      prisma.task.count.mockResolvedValue(5);

      await expect(service.remove(WS, 'open-1', USER)).rejects.toThrow(
        'Provide replacementTaskStatusId',
      );
    });

    it('throws BadRequestException when replacement equals deleted status', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst.mockResolvedValue(openStatus);
      prisma.workspaceTaskStatus.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(2);
      prisma.task.count.mockResolvedValue(5);

      await expect(
        service.remove(WS, 'open-1', USER, 'open-1'),
      ).rejects.toThrow('Replacement status must differ');
    });

    it('throws BadRequestException when replacement is invalid', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst
        .mockResolvedValueOnce(openStatus) // findById
        .mockResolvedValueOnce(null); // replacement lookup
      prisma.workspaceTaskStatus.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(2);
      prisma.task.count.mockResolvedValue(5);

      await expect(
        service.remove(WS, 'open-1', USER, 'bad-replacement'),
      ).rejects.toThrow('Invalid replacement task status');
    });

    it('migrates tasks to replacement status then deletes', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      const replacement = makeStatus({ id: 'open-2', name: 'To Do' });
      prisma.workspaceTaskStatus.findFirst
        .mockResolvedValueOnce(openStatus) // findById
        .mockResolvedValueOnce(replacement); // replacement lookup
      prisma.workspaceTaskStatus.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(2);
      prisma.task.count.mockResolvedValue(3);
      prisma.task.updateMany.mockResolvedValue({ count: 3 });
      prisma.workspaceTaskStatus.delete.mockResolvedValue(openStatus);

      await service.remove(WS, 'open-1', USER, 'open-2');

      expect(prisma.task.updateMany).toHaveBeenCalledWith({
        where: { workspaceId: WS, status: 'open-1', deletedAt: null },
        data: { status: 'open-2' },
      });
      expect(prisma.workspaceTaskStatus.delete).toHaveBeenCalledWith({
        where: { id: 'open-1' },
      });
    });
  });

  describe('swap', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.swap(WS, USER, 'a', 'b')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when either status is not found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.workspaceTaskStatus.findFirst
        .mockResolvedValueOnce(openStatus)
        .mockResolvedValueOnce(null);

      await expect(service.swap(WS, USER, 'open-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('swaps sortOrder of two statuses in a transaction', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      const statusA = makeStatus({ id: 'a', sortOrder: 0 });
      const statusB = makeStatus({ id: 'b', sortOrder: 1, isTerminal: true });
      prisma.workspaceTaskStatus.findFirst
        .mockResolvedValueOnce(statusA)
        .mockResolvedValueOnce(statusB);
      const updatedA = { ...statusA, sortOrder: 1 };
      const updatedB = { ...statusB, sortOrder: 0 };
      prisma.$transaction.mockResolvedValue([updatedA, updatedB]);

      const result = await service.swap(WS, USER, 'a', 'b');

      expect(result.statuses).toHaveLength(2);
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('terminalStatusIds', () => {
    it('returns ids of all terminal statuses', async () => {
      prisma.workspaceTaskStatus.count.mockResolvedValue(3);
      prisma.workspaceTaskStatus.findMany.mockResolvedValue([
        { id: 'done-1' },
        { id: 'done-2' },
      ]);

      const result = await service.terminalStatusIds(WS);

      expect(result).toEqual(['done-1', 'done-2']);
    });
  });
});
