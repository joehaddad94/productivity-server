import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Workspace } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let prisma: {
    workspace: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    workspaceMember: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };

  const mockWorkspace: Workspace = {
    id: 'ws-1',
    name: 'My Workspace',
    slug: 'my-workspace',
    isPersonal: false,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrisma = {
      workspace: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      workspaceMember: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspacesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WorkspacesService>(WorkspacesService);
    prisma = module.get(PrismaService) as typeof mockPrisma;
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates workspace and adds user as owner when slug is unique', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.workspace.findFirst.mockResolvedValue(null);
      prisma.workspace.create.mockResolvedValue(mockWorkspace);
      prisma.workspaceMember.create.mockResolvedValue({} as never);

      const result = await service.create(
        { name: 'My Workspace', slug: 'my-workspace' },
        'user-1',
      );

      expect(result).toEqual(mockWorkspace);
      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: {
          name: 'My Workspace',
          slug: 'my-workspace',
          isPersonal: false,
        },
      });
      expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', workspaceId: 'ws-1', role: 'owner' },
      });
    });

    it('derives slug from name when slug is omitted', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.workspace.findFirst.mockResolvedValue(null);
      prisma.workspace.create.mockImplementation((args: { data: { slug: string } }) =>
        Promise.resolve({ ...mockWorkspace, slug: args.data.slug }),
      );
      prisma.workspaceMember.create.mockResolvedValue({} as never);

      await service.create({ name: '  Hello World  ' }, 'user-1');

      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Hello World',
          slug: 'hello-world',
          isPersonal: false,
        }),
      });
    });

    it('trims name and uses isPersonal when provided', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.workspace.findFirst.mockResolvedValue(null);
      prisma.workspace.create.mockResolvedValue({
        ...mockWorkspace,
        isPersonal: true,
      });
      prisma.workspaceMember.create.mockResolvedValue({} as never);

      await service.create(
        { name: '  Personal  ', isPersonal: true },
        'user-1',
      );

      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Personal',
          isPersonal: true,
        }),
      });
    });

    it('throws ConflictException when user already has a workspace with same name/slug', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([
        { workspace: { slug: 'my-workspace' } },
      ]);
      prisma.workspace.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ name: 'My Workspace' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.create({ name: 'My Workspace' }, 'user-1'),
      ).rejects.toThrow('You already have a workspace with this name or slug');

      expect(prisma.workspace.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when user provides same slug as existing workspace they own', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([
        { workspace: { slug: 'existing' } },
      ]);

      await expect(
        service.create({ name: 'Other', slug: 'existing' }, 'user-1'),
      ).rejects.toThrow(ConflictException);

      expect(prisma.workspace.create).not.toHaveBeenCalled();
    });

    it('allows same name when slug differs (different user has that slug)', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.workspace.findFirst.mockResolvedValue(null);
      prisma.workspace.create.mockResolvedValue(mockWorkspace);
      prisma.workspaceMember.create.mockResolvedValue({} as never);

      const result = await service.create(
        { name: 'My Workspace', slug: 'my-workspace' },
        'user-1',
      );

      expect(result).toEqual(mockWorkspace);
      expect(prisma.workspace.create).toHaveBeenCalled();
    });

    it('uniquifies slug when another workspace (e.g. another user) already has it', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.workspace.findFirst
        .mockResolvedValueOnce({ id: 'other-ws' })
        .mockResolvedValueOnce(null);
      prisma.workspace.create.mockImplementation((args: { data: { slug: string } }) =>
        Promise.resolve({ ...mockWorkspace, slug: args.data.slug }),
      );
      prisma.workspaceMember.create.mockResolvedValue({} as never);

      await service.create({ name: 'My Workspace' }, 'user-1');

      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          slug: expect.stringMatching(/^my-workspace-[a-z0-9]+$/),
        }),
      });
    });
  });

  describe('findByUserId', () => {
    it('returns empty array when user has no workspaces', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([]);

      const result = await service.findByUserId('user-1');

      expect(result).toEqual([]);
    });

    it('returns all workspaces the user is a member of', async () => {
      const ws1 = { ...mockWorkspace, id: 'ws-1' };
      const ws2 = { ...mockWorkspace, id: 'ws-2', name: 'Second' };
      prisma.workspaceMember.findMany.mockResolvedValue([
        { workspace: ws1 },
        { workspace: ws2 },
      ]);

      const result = await service.findByUserId('user-1');

      expect(result).toEqual([ws1, ws2]);
      expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: { workspace: true },
      });
    });
  });

  describe('findOne', () => {
    it('returns workspace when user is a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        workspace: mockWorkspace,
      });

      const result = await service.findOne('ws-1', 'user-1');

      expect(result).toEqual(mockWorkspace);
      expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith({
        where: {
          userId_workspaceId: { userId: 'user-1', workspaceId: 'ws-1' },
        },
        include: { workspace: true },
      });
    });

    it('throws NotFoundException when user is not a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.findOne('ws-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne('ws-1', 'user-1')).rejects.toThrow(
        'Workspace not found',
      );
    });
  });

  describe('update', () => {
    it('updates only provided fields', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        workspace: mockWorkspace,
      });
      prisma.workspace.update.mockResolvedValue({
        ...mockWorkspace,
        name: 'Updated Name',
      });

      const result = await service.update(
        'ws-1',
        'user-1',
        { name: 'Updated Name' },
      );

      expect(result.name).toBe('Updated Name');
      expect(prisma.workspace.update).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        data: { name: 'Updated Name' },
      });
    });

    it('throws NotFoundException when user is not a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.update('ws-1', 'user-1', { name: 'New' }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.workspace.update).not.toHaveBeenCalled();
    });

    it('uniquifies slug when it conflicts with another workspace', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        workspace: mockWorkspace,
      });
      prisma.workspace.findFirst
        .mockResolvedValueOnce({ id: 'other-ws' })
        .mockResolvedValueOnce(null);
      prisma.workspace.update.mockImplementation((args: { data: { slug: string } }) =>
        Promise.resolve({ ...mockWorkspace, slug: args.data.slug }),
      );

      await service.update('ws-1', 'user-1', { slug: 'taken' });

      expect(prisma.workspace.update).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        data: {
          slug: expect.stringMatching(/^taken-[a-z0-9]+$/),
        },
      });
    });

    it('allows keeping same slug when updating own workspace (excludeId)', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        workspace: mockWorkspace,
      });
      prisma.workspace.findFirst.mockResolvedValue(null);
      prisma.workspace.update.mockResolvedValue(mockWorkspace);

      await service.update('ws-1', 'user-1', { slug: 'my-workspace' });

      expect(prisma.workspace.update).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        data: { slug: 'my-workspace' },
      });
      expect(prisma.workspace.findFirst).toHaveBeenCalledWith({
        where: { slug: 'my-workspace', id: { not: 'ws-1' } },
      });
    });
  });

  describe('remove', () => {
    it('deletes workspace when user is owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'owner',
        workspaceId: 'ws-1',
      });
      prisma.workspace.delete.mockResolvedValue(mockWorkspace);

      await service.remove('ws-1', 'user-1');

      expect(prisma.workspace.delete).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
      });
    });

    it('throws ForbiddenException when user is member but not owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'member',
        workspaceId: 'ws-1',
      });

      await expect(service.remove('ws-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.remove('ws-1', 'user-1')).rejects.toThrow(
        'Only the workspace owner can delete it',
      );

      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when user is not a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.remove('ws-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove('ws-1', 'user-1')).rejects.toThrow(
        'Workspace not found',
      );

      expect(prisma.workspace.delete).not.toHaveBeenCalled();
    });
  });
});
