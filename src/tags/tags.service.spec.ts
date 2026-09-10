import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Note } from '@prisma/client';
import { TagsService } from './tags.service';
import { PrismaService } from '../prisma/prisma.service';
import { membershipCache, membershipKey } from '../common/membership-cache';

describe('TagsService', () => {
  let service: TagsService;
  let prisma: {
    workspaceMember: { findUnique: jest.Mock };
    note: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
  };

  const WS = 'ws-1';
  const USER = 'user-1';

  const mockNote: Note = {
    id: 'note-1',
    workspaceId: WS,
    title: 'Note',
    content: '',
    tags: ['existing'],
    projectId: null,
    taskId: null,
    assigneeId: null,
    status: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    membershipCache.delete(membershipKey(USER, WS));

    const mockPrisma = {
      workspaceMember: { findUnique: jest.fn() },
      note: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TagsService>(TagsService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('addTags', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.addTags(WS, 'note-1', USER, ['tag']),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when no valid tags provided', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });

      await expect(
        service.addTags(WS, 'note-1', USER, ['', '   ']),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when a tag exceeds 40 characters', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });

      await expect(
        service.addTags(WS, 'note-1', USER, ['a'.repeat(41)]),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.addTags(WS, 'note-1', USER, ['a'.repeat(41)]),
      ).rejects.toThrow('exceeds 40 characters');
    });

    it('throws NotFoundException when note does not exist', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(null);

      await expect(
        service.addTags(WS, 'missing', USER, ['new-tag']),
      ).rejects.toThrow(NotFoundException);
    });

    it('adds new tags and merges with existing', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(mockNote);
      prisma.note.update.mockResolvedValue({
        ...mockNote,
        tags: ['existing', 'new-tag'],
      });

      const result = await service.addTags(WS, 'note-1', USER, ['New-Tag']);

      expect(prisma.note.update).toHaveBeenCalledWith({
        where: { id: 'note-1' },
        data: { tags: ['existing', 'new-tag'] },
      });
      expect(result.tags).toEqual(['existing', 'new-tag']);
    });

    it('normalizes tags to lowercase and trimmed', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      const noteNoTags = { ...mockNote, tags: [] };
      prisma.note.findFirst.mockResolvedValue(noteNoTags);
      prisma.note.update.mockResolvedValue({ ...noteNoTags, tags: ['design'] });

      await service.addTags(WS, 'note-1', USER, ['  DESIGN  ']);

      expect(prisma.note.update).toHaveBeenCalledWith({
        where: { id: 'note-1' },
        data: { tags: ['design'] },
      });
    });

    it('deduplicates incoming tags', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      const noteNoTags = { ...mockNote, tags: [] };
      prisma.note.findFirst.mockResolvedValue(noteNoTags);
      prisma.note.update.mockResolvedValue({ ...noteNoTags, tags: ['alpha'] });

      await service.addTags(WS, 'note-1', USER, ['alpha', 'Alpha', 'ALPHA']);

      expect(prisma.note.update).toHaveBeenCalledWith({
        where: { id: 'note-1' },
        data: { tags: ['alpha'] },
      });
    });

    it('returns note unchanged when all incoming tags already exist', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(mockNote);

      const result = await service.addTags(WS, 'note-1', USER, ['existing']);

      expect(prisma.note.update).not.toHaveBeenCalled();
      expect(result).toEqual(mockNote);
    });
  });

  describe('removeTag', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.removeTag(WS, 'note-1', USER, 'tag'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when tag is empty', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });

      await expect(
        service.removeTag(WS, 'note-1', USER, '   '),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when note does not exist', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(null);

      await expect(
        service.removeTag(WS, 'missing', USER, 'existing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('removes the tag from the note', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(mockNote);
      prisma.note.update.mockResolvedValue({ ...mockNote, tags: [] });

      const result = await service.removeTag(WS, 'note-1', USER, 'Existing');

      expect(prisma.note.update).toHaveBeenCalledWith({
        where: { id: 'note-1' },
        data: { tags: [] },
      });
      expect(result.tags).toEqual([]);
    });

    it('returns note unchanged when tag not present', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.note.findFirst.mockResolvedValue(mockNote);

      const result = await service.removeTag(WS, 'note-1', USER, 'absent');

      expect(prisma.note.update).not.toHaveBeenCalled();
      expect(result).toEqual(mockNote);
    });
  });

  describe('listWorkspaceTags', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.listWorkspaceTags(WS, USER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns tag counts from raw query', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.$queryRaw.mockResolvedValue([
        { tag: 'design', count: 3 },
        { tag: 'dev', count: 1 },
      ]);

      const result = await service.listWorkspaceTags(WS, USER);

      expect(result).toEqual([
        { tag: 'design', count: 3 },
        { tag: 'dev', count: 1 },
      ]);
    });

    it('converts bigint count values to number', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.$queryRaw.mockResolvedValue([{ tag: 'bug', count: BigInt(5) }]);

      const result = await service.listWorkspaceTags(WS, USER);

      expect(result[0].count).toBe(5);
      expect(typeof result[0].count).toBe('number');
    });
  });

  describe('renameTag', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.renameTag(WS, USER, 'old', 'new'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns { renamed: 0 } when from and to normalize to same tag', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });

      const result = await service.renameTag(WS, USER, 'Tag', 'tag');

      expect(result).toEqual({ renamed: 0 });
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('executes raw update and returns renamed count', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.$executeRaw.mockResolvedValue(3);

      const result = await service.renameTag(WS, USER, 'old', 'new');

      expect(result).toEqual({ renamed: 3 });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteTag', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.deleteTag(WS, USER, 'tag')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('executes raw update and returns affected count', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.$executeRaw.mockResolvedValue(2);

      const result = await service.deleteTag(WS, USER, 'design');

      expect(result).toEqual({ affected: 2 });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });
});
