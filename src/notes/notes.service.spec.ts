import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Note } from '@prisma/client';
import { NotesService } from './notes.service';
import { PrismaService } from '../prisma/prisma.service';
import { membershipCache, membershipKey } from '../common/membership-cache';

describe('NotesService', () => {
  let service: NotesService;
  let prisma: {
    workspaceMember: { findUnique: jest.Mock };
    note: {
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const WS = 'ws-1';
  const USER = 'user-1';

  const mockNote: Note = {
    id: 'note-1',
    workspaceId: WS,
    title: 'My Note',
    content: 'Content here',
    tags: [],
    projectId: null,
    taskId: null,
    assigneeId: null,
    status: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    contentText: null,
    deletedAt: null,
  };

  beforeEach(async () => {
    membershipCache.delete(membershipKey(USER, WS));

    const mockPrisma = {
      workspaceMember: { findUnique: jest.fn() },
      note: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.list(WS, USER, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns notes and total with no filters', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findMany.mockResolvedValue([mockNote]);
      prisma.note.count.mockResolvedValue(1);

      const result = await service.list(WS, USER, {});

      expect(result.notes).toEqual([mockNote]);
      expect(result.total).toBe(1);
    });

    it('applies search filter with OR on title and content', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findMany.mockResolvedValue([]);
      prisma.note.count.mockResolvedValue(0);

      await service.list(WS, USER, { search: 'hello' });

      const call = prisma.note.findMany.mock.calls[0][0] as {
        where: { OR?: unknown[] };
      };
      expect(call.where.OR).toBeDefined();
      expect(call.where.OR).toHaveLength(2);
    });

    it('filters by tags with hasSome by default', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findMany.mockResolvedValue([]);
      prisma.note.count.mockResolvedValue(0);

      await service.list(WS, USER, { tags: 'a,b' });

      const call = prisma.note.findMany.mock.calls[0][0] as {
        where: { tags?: { hasSome?: string[] } };
      };
      expect(call.where.tags?.hasSome).toEqual(['a', 'b']);
    });

    it('filters by tags with hasEvery when tagMode is "all"', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findMany.mockResolvedValue([]);
      prisma.note.count.mockResolvedValue(0);

      await service.list(WS, USER, { tags: 'a,b', tagMode: 'all' });

      const call = prisma.note.findMany.mock.calls[0][0] as {
        where: { tags?: { hasEvery?: string[] } };
      };
      expect(call.where.tags?.hasEvery).toEqual(['a', 'b']);
    });

    it('filters by projectId', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findMany.mockResolvedValue([]);
      prisma.note.count.mockResolvedValue(0);

      await service.list(WS, USER, { projectId: 'proj-1' });

      const call = prisma.note.findMany.mock.calls[0][0] as {
        where: { projectId?: string };
      };
      expect(call.where.projectId).toBe('proj-1');
    });

    it('filters by taskId', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findMany.mockResolvedValue([]);
      prisma.note.count.mockResolvedValue(0);

      await service.list(WS, USER, { taskId: 'task-1' });

      const call = prisma.note.findMany.mock.calls[0][0] as {
        where: { taskId?: string };
      };
      expect(call.where.taskId).toBe('task-1');
    });

    it('applies default limit 50 and skip 0', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findMany.mockResolvedValue([]);
      prisma.note.count.mockResolvedValue(0);

      await service.list(WS, USER, {});

      expect(prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0 }),
      );
    });
  });

  describe('create', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.create(WS, USER, { title: 'Note', content: '' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates note with trimmed title and empty tags by default', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.create.mockResolvedValue(mockNote);

      const result = await service.create(WS, USER, {
        title: '  My Note  ',
        content: 'Content here',
      });

      expect(result).toEqual(mockNote);
      expect(prisma.note.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: WS,
          title: 'My Note',
          content: 'Content here',
          tags: [],
        }),
      });
    });

    it('creates note with provided tags, projectId, and taskId', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.create.mockResolvedValue({
        ...mockNote,
        tags: ['design'],
        projectId: 'proj-1',
        taskId: 'task-1',
      });

      await service.create(WS, USER, {
        title: 'Tagged Note',
        content: '',
        tags: ['design'],
        projectId: 'proj-1',
        taskId: 'task-1',
      });

      expect(prisma.note.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tags: ['design'],
          projectId: 'proj-1',
          taskId: 'task-1',
        }),
      });
    });
  });

  describe('findOne', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.findOne(WS, 'note-1', USER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns note when found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(mockNote);

      const result = await service.findOne(WS, 'note-1', USER);

      expect(result).toEqual(mockNote);
      expect(prisma.note.findFirst).toHaveBeenCalledWith({
        where: { id: 'note-1', workspaceId: WS, deletedAt: null },
      });
    });

    it('throws NotFoundException when note not found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(null);

      await expect(service.findOne(WS, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne(WS, 'missing', USER)).rejects.toThrow(
        'Note not found',
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when note not found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(null);

      await expect(
        service.update(WS, 'missing', USER, { title: 'X' }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.note.update).not.toHaveBeenCalled();
    });

    it('trims title when provided', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(mockNote);
      prisma.note.update.mockResolvedValue({ ...mockNote, title: 'Updated' });

      await service.update(WS, 'note-1', USER, { title: '  Updated  ' });

      expect(prisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Updated' }),
        }),
      );
    });

    it('unlinks projectId when null passed in dto', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue({
        ...mockNote,
        projectId: 'proj-1',
      });
      prisma.note.update.mockResolvedValue({ ...mockNote, projectId: null });

      await service.update(WS, 'note-1', USER, { projectId: null });

      const callData = prisma.note.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(callData.projectId).toBeNull();
    });

    it('links projectId when string passed in dto', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(mockNote);
      prisma.note.update.mockResolvedValue({
        ...mockNote,
        projectId: 'proj-2',
      });

      await service.update(WS, 'note-1', USER, { projectId: 'proj-2' });

      const callData = prisma.note.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(callData.projectId).toBe('proj-2');
    });

    it('does not include projectId when not in dto', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(mockNote);
      prisma.note.update.mockResolvedValue(mockNote);

      await service.update(WS, 'note-1', USER, { title: 'Title only' });

      const callData = prisma.note.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(callData).not.toHaveProperty('projectId');
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when note not found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(null);

      await expect(service.remove(WS, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.note.delete).not.toHaveBeenCalled();
    });

    it('soft-deletes the note', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(mockNote);
      prisma.note.update.mockResolvedValue({ ...mockNote, deletedAt: new Date() });

      await service.remove(WS, 'note-1', USER);

      expect(prisma.note.delete).not.toHaveBeenCalled();
      expect(prisma.note.update).toHaveBeenCalledWith({
        where: { id: 'note-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
