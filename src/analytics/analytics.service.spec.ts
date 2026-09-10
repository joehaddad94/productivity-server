import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { membershipCache, membershipKey } from '../common/membership-cache';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: {
    workspaceMember: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    dailyStat: {
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
  };

  const WS = 'ws-1';
  const USER = 'user-1';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const twoDaysAgo = new Date(today);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const makeStat = (date: Date, tasksCompleted = 1, focusMinutes = 0) => ({
    id: `stat-${date.toISOString()}`,
    workspaceId: WS,
    userId: USER,
    date,
    tasksCompleted,
    focusMinutes,
    createdAt: date,
  });

  beforeEach(async () => {
    membershipCache.delete(membershipKey(USER, WS));

    const mockPrisma = {
      workspaceMember: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      dailyStat: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    prisma = module.get(PrismaService);

    // computeStreak reads the user's timezone; default it for every test.
    prisma.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    jest.clearAllMocks();
  });

  describe('getAnalytics', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.getAnalytics(WS, USER, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns daily stats and totals with no date range', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      const stats = [makeStat(today, 2, 30), makeStat(yesterday, 1, 15)];
      prisma.dailyStat.findMany
        .mockResolvedValueOnce(stats)
        .mockResolvedValueOnce(stats);

      const result = await service.getAnalytics(WS, USER, {});

      expect(result.dailyStats).toEqual(stats);
      expect(result.totals.tasksCompleted).toBe(3);
      expect(result.totals.focusMinutes).toBe(45);
    });

    it('passes date range to range query but uses all stats for streak', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      const rangeStats = [makeStat(today, 1, 0)];
      const allStats = [makeStat(today, 1, 0), makeStat(yesterday, 2, 10)];
      prisma.dailyStat.findMany
        .mockResolvedValueOnce(rangeStats)
        .mockResolvedValueOnce(allStats);

      const result = await service.getAnalytics(WS, USER, {
        from: today.toISOString(),
        to: today.toISOString(),
      });

      expect(result.dailyStats).toEqual(rangeStats);
      // Two consecutive days → streak of 2
      expect(result.totals.streak).toBe(2);
    });

    it('returns zero totals for empty stats', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.dailyStat.findMany.mockResolvedValue([]);

      const result = await service.getAnalytics(WS, USER, {});

      expect(result.totals.tasksCompleted).toBe(0);
      expect(result.totals.focusMinutes).toBe(0);
      expect(result.totals.streak).toBe(0);
    });

    describe('streak computation', () => {
      const setupStreak = (allStats: ReturnType<typeof makeStat>[]) => {
        prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
        prisma.dailyStat.findMany
          .mockResolvedValueOnce(allStats)
          .mockResolvedValueOnce(allStats);
      };

      it('returns 1 for only today', async () => {
        setupStreak([makeStat(today, 1, 0)]);

        const result = await service.getAnalytics(WS, USER, {});

        expect(result.totals.streak).toBe(1);
      });

      it('returns 2 for today and yesterday', async () => {
        setupStreak([makeStat(today, 1, 0), makeStat(yesterday, 1, 0)]);

        const result = await service.getAnalytics(WS, USER, {});

        expect(result.totals.streak).toBe(2);
      });

      it('breaks streak when day has no activity', async () => {
        setupStreak([
          makeStat(today, 1, 0),
          makeStat(yesterday, 0, 0),
          makeStat(twoDaysAgo, 1, 0),
        ]);

        const result = await service.getAnalytics(WS, USER, {});

        expect(result.totals.streak).toBe(1);
      });

      it('counts focusMinutes as activity for streak', async () => {
        setupStreak([makeStat(today, 0, 30), makeStat(yesterday, 0, 15)]);

        const result = await service.getAnalytics(WS, USER, {});

        expect(result.totals.streak).toBe(2);
      });

      it('breaks streak on gap (non-consecutive day)', async () => {
        setupStreak([makeStat(today, 1, 0), makeStat(twoDaysAgo, 1, 0)]);

        const result = await service.getAnalytics(WS, USER, {});

        expect(result.totals.streak).toBe(1);
      });

      it('counts across a daylight-saving boundary', async () => {
        // US spring-forward is 2026-03-08. Consecutive local midnights either
        // side are 23 hours apart, so the old millisecond diff was 0.958 and
        // matched neither `> 1` nor `=== 1`: the loop fell through without
        // breaking or advancing and miscounted the streak.
        jest.useFakeTimers().setSystemTime(new Date('2026-03-09T15:00:00Z'));
        prisma.user.findUnique.mockResolvedValue({
          timezone: 'America/New_York',
        });
        const day = (d: string) => new Date(`${d}T00:00:00Z`);
        setupStreak([
          makeStat(day('2026-03-09'), 1, 0),
          makeStat(day('2026-03-08'), 1, 0),
          makeStat(day('2026-03-07'), 1, 0),
        ]);

        const result = await service.getAnalytics(WS, USER, {});

        expect(result.totals.streak).toBe(3);
        jest.useRealTimers();
      });

      it("uses the user's timezone, not the server's, for today", async () => {
        // 2026-03-10T02:00Z is still 2026-03-09 in New York (21:00 the day
        // before). A streak ending on the 9th is therefore still live there,
        // even though the server's UTC clock has already rolled over.
        jest.useFakeTimers().setSystemTime(new Date('2026-03-10T02:00:00Z'));
        prisma.user.findUnique.mockResolvedValue({
          timezone: 'America/New_York',
        });
        const day = (d: string) => new Date(`${d}T00:00:00Z`);
        setupStreak([
          makeStat(day('2026-03-09'), 1, 0),
          makeStat(day('2026-03-08'), 1, 0),
        ]);

        const result = await service.getAnalytics(WS, USER, {});

        expect(result.totals.streak).toBe(2);
        jest.useRealTimers();
      });

      it('returns 3 for three consecutive days', async () => {
        setupStreak([
          makeStat(today, 1, 0),
          makeStat(yesterday, 1, 0),
          makeStat(twoDaysAgo, 1, 0),
        ]);

        const result = await service.getAnalytics(WS, USER, {});

        expect(result.totals.streak).toBe(3);
      });
    });
  });

  describe('logStat', () => {
    it('throws ForbiddenException when user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.logStat(WS, USER, { tasksCompleted: 1 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('upserts stat for today when no date provided', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.dailyStat.upsert.mockResolvedValue(makeStat(today, 1, 0));

      await service.logStat(WS, USER, { tasksCompleted: 1 });

      const call = prisma.dailyStat.upsert.mock.calls[0][0] as {
        where: { workspaceId_userId_date: { date: Date } };
        create: { date: Date };
      };
      const callDate = call.where.workspaceId_userId_date.date;
      callDate.setHours(0, 0, 0, 0);
      expect(callDate.toDateString()).toBe(today.toDateString());
    });

    it('uses the provided date', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.dailyStat.upsert.mockResolvedValue(makeStat(yesterday));

      await service.logStat(WS, USER, {
        date: yesterday.toISOString(),
        focusMinutes: 25,
      });

      const call = prisma.dailyStat.upsert.mock.calls[0][0] as {
        where: { workspaceId_userId_date: { date: Date } };
      };
      const callDate = call.where.workspaceId_userId_date.date;
      expect(callDate.toDateString()).toBe(yesterday.toDateString());
    });

    it('increments tasksCompleted and focusMinutes', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.dailyStat.upsert.mockResolvedValue(makeStat(today, 2, 25));

      await service.logStat(WS, USER, { tasksCompleted: 2, focusMinutes: 25 });

      expect(prisma.dailyStat.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { tasksCompleted: { increment: 2 }, focusMinutes: { increment: 25 } },
          create: expect.objectContaining({
            tasksCompleted: 2,
            focusMinutes: 25,
          }),
        }),
      );
    });

    it('defaults missing stat fields to 0', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.dailyStat.upsert.mockResolvedValue(makeStat(today));

      await service.logStat(WS, USER, {});

      expect(prisma.dailyStat.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { tasksCompleted: { increment: 0 }, focusMinutes: { increment: 0 } },
        }),
      );
    });
  });
});
