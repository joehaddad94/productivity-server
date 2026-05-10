import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  const mockUser: User = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Jane',
    avatarUrl: null,
    timezone: null,
    isAdmin: false,
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('findByEmail', () => {
    it('returns the user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByEmail('user@example.com');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
    });

    it('returns null when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('missing@example.com');

      expect(result).toBeNull();
    });

    it('normalizes email to lowercase and trimmed', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.findByEmail('  UPPER@EXAMPLE.COM  ');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'upper@example.com' },
      });
    });
  });

  describe('findById', () => {
    it('returns the user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findById('user-1');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('returns null when user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('creates user with normalized email and name', async () => {
      prisma.user.create.mockResolvedValue(mockUser);

      const result = await service.create({
        email: '  User@EXAMPLE.COM  ',
        name: 'Jane',
      });

      expect(result).toEqual(mockUser);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'user@example.com', name: 'Jane' },
      });
    });

    it('sets name to null when not provided', async () => {
      prisma.user.create.mockResolvedValue({ ...mockUser, name: null });

      await service.create({ email: 'new@example.com' });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'new@example.com', name: null },
      });
    });

    it('sets name to null when explicitly null', async () => {
      prisma.user.create.mockResolvedValue({ ...mockUser, name: null });

      await service.create({ email: 'new@example.com', name: null });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'new@example.com', name: null },
      });
    });
  });

  describe('updateProfile', () => {
    it('trims name and updates', async () => {
      const updated = { ...mockUser, name: 'New Name' };
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.updateProfile('user-1', {
        name: '  New Name  ',
      });

      expect(result.name).toBe('New Name');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: 'New Name' },
      });
    });

    it('converts empty name to null', async () => {
      prisma.user.update.mockResolvedValue({ ...mockUser, name: null });

      await service.updateProfile('user-1', { name: '   ' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { name: null },
      });
    });

    it('updates timezone when provided', async () => {
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        timezone: 'America/New_York',
      });

      await service.updateProfile('user-1', { timezone: 'America/New_York' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { timezone: 'America/New_York' },
      });
    });

    it('converts empty timezone to null', async () => {
      prisma.user.update.mockResolvedValue({ ...mockUser, timezone: null });

      await service.updateProfile('user-1', { timezone: '' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { timezone: null },
      });
    });

    it('only includes provided fields in update', async () => {
      prisma.user.update.mockResolvedValue(mockUser);

      await service.updateProfile('user-1', { timezone: 'UTC' });

      const callData = prisma.user.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(callData).not.toHaveProperty('name');
      expect(callData).toHaveProperty('timezone', 'UTC');
    });
  });

  describe('deleteAccount', () => {
    it('deletes the user by id', async () => {
      prisma.user.delete.mockResolvedValue(mockUser);

      await service.deleteAccount('user-1');

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });
  });
});
