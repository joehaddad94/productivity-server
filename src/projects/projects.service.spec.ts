import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Project } from '@prisma/client';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { membershipCache, membershipKey } from '../common/membership-cache';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let prisma: {
    workspaceMember: { findUnique: jest.Mock };
    project: {
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };

  const WS = 'ws-1';
  const USER = 'user-1';

  const mockProject: Project & { _count: { notes: number; tasks: number } } = {
    id: 'proj-1',
    workspaceId: WS,
    name: 'My Project',
    description: null,
    status: 'active',
    color: null,
    deletedAt: null,
    createdAt: new Date(),
    _count: { notes: 0, tasks: 0 },
  };

  beforeEach(async () => {
    membershipCache.delete(membershipKey(USER, WS));

    const mockPrisma = {
      workspaceMember: { findUnique: jest.fn() },
      project: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
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

    it('returns projects and total', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.findMany.mockResolvedValue([mockProject]);
      prisma.project.count.mockResolvedValue(1);

      const result = await service.list(WS, USER, {});

      expect(result.projects).toEqual([mockProject]);
      expect(result.total).toBe(1);
    });

    it('applies default limit 50 and skip 0', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.findMany.mockResolvedValue([]);
      prisma.project.count.mockResolvedValue(0);

      await service.list(WS, USER, {});

      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0 }),
      );
    });

    it('respects provided limit and skip', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.findMany.mockResolvedValue([]);
      prisma.project.count.mockResolvedValue(0);

      await service.list(WS, USER, { limit: 10, skip: 20 });

      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 20 }),
      );
    });
  });

  describe('create', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.create(WS, USER, { name: 'Test' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates project with trimmed name and default active status', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.create.mockResolvedValue(mockProject);

      const result = await service.create(WS, USER, {
        name: '  My Project  ',
      });

      expect(result).toEqual(mockProject);
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: WS,
          name: 'My Project',
          status: 'active',
        }),
      });
    });

    it('uses provided status and color', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.create.mockResolvedValue({
        ...mockProject,
        status: 'archived',
        color: '#ff0000',
      });

      await service.create(WS, USER, {
        name: 'Archived',
        status: 'archived',
        color: '#ff0000',
      });

      expect(prisma.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'archived',
          color: '#ff0000',
        }),
      });
    });
  });

  describe('findOne', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.findOne(WS, 'proj-1', USER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns project when found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.findFirst.mockResolvedValue(mockProject);

      const result = await service.findOne(WS, 'proj-1', USER);

      expect(result).toEqual(mockProject);
      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: { id: 'proj-1', workspaceId: WS, deletedAt: null },
        include: { _count: { select: { notes: true, tasks: true } } },
      });
    });

    it('throws NotFoundException when project not found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(service.findOne(WS, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne(WS, 'missing', USER)).rejects.toThrow(
        'Project not found',
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when project not found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(
        service.update(WS, 'missing', USER, { name: 'New' }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('updates only provided fields and trims name', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.findFirst.mockResolvedValue(mockProject);
      prisma.project.update.mockResolvedValue({
        ...mockProject,
        name: 'Updated',
      });

      const result = await service.update(WS, 'proj-1', USER, {
        name: '  Updated  ',
      });

      expect(result.name).toBe('Updated');
      expect(prisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proj-1' },
          data: { name: 'Updated' },
        }),
      );
    });

    it('updates status without touching name', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.findFirst.mockResolvedValue(mockProject);
      prisma.project.update.mockResolvedValue({
        ...mockProject,
        status: 'archived',
      });

      await service.update(WS, 'proj-1', USER, { status: 'archived' });

      const callData = prisma.project.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(callData).not.toHaveProperty('name');
      expect(callData).toHaveProperty('status', 'archived');
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when project not found', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(service.remove(WS, 'missing', USER)).rejects.toThrow(
        NotFoundException,
      );

      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('soft-deletes project by setting deletedAt', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.project.findFirst.mockResolvedValue(mockProject);
      prisma.project.update.mockResolvedValue({
        ...mockProject,
        deletedAt: new Date(),
      });

      await service.remove(WS, 'proj-1', USER);

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
