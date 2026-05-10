import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BugReportsService } from './bug-reports.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BugReportsService', () => {
  let service: BugReportsService;
  let prisma: {
    workspaceMember: { findUnique: jest.Mock };
    bugReport: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      $transaction: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const now = new Date();
  const mockBugRow = {
    id: 'bug-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    title: 'Login broken',
    description: 'Cannot log in',
    expected: 'Login succeeds',
    actual: 'Error shown',
    route: '/login',
    userAgent: 'Mozilla/5.0',
    contextJson: null,
    status: 'open',
    priority: 'high',
    resolvedAt: null,
    resolutionNote: null,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(async () => {
    const mockPrisma = {
      workspaceMember: { findUnique: jest.fn() },
      bugReport: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BugReportsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BugReportsService>(BugReportsService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('throws ForbiddenException when workspaceId provided and user is not a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user-1', {
          workspaceId: 'ws-1',
          title: 'Bug',
          description: 'Desc',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.bugReport.create).not.toHaveBeenCalled();
    });

    it('creates bug report with workspaceId when user is a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'member-1' });
      prisma.bugReport.create.mockResolvedValue(mockBugRow);

      const result = await service.create('user-1', {
        workspaceId: 'ws-1',
        title: '  Login broken  ',
        description: '  Cannot log in  ',
        expected: 'Login succeeds',
        actual: 'Error shown',
        route: '/login',
        userAgent: 'Mozilla/5.0',
      });

      expect(result.bug.title).toBe('Login broken');
      expect(prisma.bugReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          workspaceId: 'ws-1',
          title: 'Login broken',
          description: 'Cannot log in',
        }),
      });
    });

    it('creates bug report without workspace membership check when no workspaceId', async () => {
      const rowNoWs = { ...mockBugRow, workspaceId: null };
      prisma.bugReport.create.mockResolvedValue(rowNoWs);

      const result = await service.create('user-1', {
        title: 'Global bug',
        description: 'Something',
      });

      expect(result.bug.workspaceId).toBeNull();
      expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
    });

    it('trims optional fields and converts empty strings to null', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'member-1' });
      prisma.bugReport.create.mockResolvedValue(mockBugRow);

      await service.create('user-1', {
        workspaceId: 'ws-1',
        title: 'Bug',
        description: 'Desc',
        expected: '   ',
        actual: '   ',
        route: '   ',
      });

      expect(prisma.bugReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          expected: null,
          actual: null,
          route: null,
        }),
      });
    });
  });

  describe('listAdmin', () => {
    it('returns all bugs when no status filter', async () => {
      const rows = [mockBugRow];
      prisma.$transaction.mockResolvedValue([rows, 1]);

      const result = await service.listAdmin({});

      expect(result.total).toBe(1);
      expect(result.bugs).toHaveLength(1);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('filters by status when provided and not "all"', async () => {
      prisma.$transaction.mockResolvedValue([[mockBugRow], 1]);

      await service.listAdmin({ status: 'open' });

      const transactionArgs = prisma.$transaction.mock.calls[0][0] as unknown[];
      expect(transactionArgs).toHaveLength(2);
    });

    it('does not filter when status is "all"', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.listAdmin({ status: 'all' });

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('maps rows to API shape including reporter fields', async () => {
      const rowWithUser = {
        ...mockBugRow,
        user: { email: 'reporter@example.com', name: 'Reporter' },
      };
      prisma.$transaction.mockResolvedValue([[rowWithUser], 1]);

      const result = await service.listAdmin({});

      expect(result.bugs[0].reporterEmail).toBe('reporter@example.com');
      expect(result.bugs[0].reporterName).toBe('Reporter');
    });
  });

  describe('statsAdmin', () => {
    it('returns byStatus, totalOpen, last7Days, and topRoutes', async () => {
      prisma.bugReport.groupBy
        .mockResolvedValueOnce([
          { status: 'open', _count: { id: 5 } },
          { status: 'wontfix', _count: { id: 2 } },
        ])
        .mockResolvedValueOnce([
          { route: '/login', _count: { id: 3 } },
          { route: '/dashboard', _count: { id: 1 } },
        ]);
      prisma.bugReport.count
        .mockResolvedValueOnce(7) // last7Days (called first)
        .mockResolvedValueOnce(4); // totalOpen (called second)

      const result = await service.statsAdmin();

      expect(result.byStatus).toEqual({ open: 5, wontfix: 2 });
      expect(result.totalOpen).toBe(4);
      expect(result.last7Days).toBe(7);
      expect(result.topRoutes).toEqual([
        { route: '/login', count: 3 },
        { route: '/dashboard', count: 1 },
      ]);
    });
  });

  describe('updateAdmin', () => {
    it('throws NotFoundException when bug report not found', async () => {
      prisma.bugReport.findUnique.mockResolvedValue(null);

      await expect(
        service.updateAdmin('non-existent', { status: 'fixed' }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.bugReport.update).not.toHaveBeenCalled();
    });

    it('updates status and priority', async () => {
      prisma.bugReport.findUnique.mockResolvedValue(mockBugRow);
      const updated = { ...mockBugRow, status: 'fixed', user: null };
      prisma.bugReport.update.mockResolvedValue(updated);

      const result = await service.updateAdmin('bug-1', {
        status: 'fixed',
        priority: 'low',
      });

      expect(result.bug.status).toBe('fixed');
      expect(prisma.bugReport.update).toHaveBeenCalledWith({
        where: { id: 'bug-1' },
        data: expect.objectContaining({ status: 'fixed', priority: 'low' }),
        include: { user: { select: { email: true, name: true } } },
      });
    });

    it('sets resolvedAt to null when explicitly null', async () => {
      prisma.bugReport.findUnique.mockResolvedValue(mockBugRow);
      prisma.bugReport.update.mockResolvedValue({
        ...mockBugRow,
        resolvedAt: null,
        user: null,
      });

      await service.updateAdmin('bug-1', { resolvedAt: null });

      expect(prisma.bugReport.update).toHaveBeenCalledWith({
        where: { id: 'bug-1' },
        data: expect.objectContaining({ resolvedAt: null }),
        include: expect.anything(),
      });
    });

    it('converts resolvedAt string to Date', async () => {
      prisma.bugReport.findUnique.mockResolvedValue(mockBugRow);
      prisma.bugReport.update.mockResolvedValue({
        ...mockBugRow,
        user: null,
      });

      await service.updateAdmin('bug-1', {
        resolvedAt: '2026-01-01T00:00:00.000Z',
      });

      const callData = prisma.bugReport.update.mock.calls[0][0].data as {
        resolvedAt: Date;
      };
      expect(callData.resolvedAt).toBeInstanceOf(Date);
    });
  });
});
