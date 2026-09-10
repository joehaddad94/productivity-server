import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertMember } from '../common/assert-member';
import { DailyStat } from '@prisma/client';
import { QueryAnalyticsDto } from './dto/query-analytics.dto';
import { LogStatDto } from './dto/log-stat.dto';

export interface AnalyticsResult {
  dailyStats: DailyStat[];
  totals: {
    tasksCompleted: number;
    focusMinutes: number;
    streak: number;
  };
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** `DailyStat.date` is a DATE column, so its UTC parts ARE the calendar day. */
  private static dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /** Today as YYYY-MM-DD in the user's own timezone (en-CA formats as ISO). */
  private static todayInZone(timeZone: string): string {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  /** Step a YYYY-MM-DD key back one day. Parsed as UTC, so DST cannot bite. */
  private static previousDay(key: string): string {
    const d = new Date(`${key}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Consecutive days with activity, counting back from today.
   *
   * Compares YYYY-MM-DD keys rather than timestamp arithmetic. The previous
   * implementation measured the gap between two local midnights in
   * milliseconds and tested `diff === 1`, which is false across a daylight
   * saving boundary where consecutive local midnights are 23 or 25 hours
   * apart. Neither branch matched, so the loop fell through without breaking
   * and without advancing, and the streak silently counted across a real gap.
   *
   * `timeZone` is the user's, not the server's. `today` used to come from
   * `new Date().setHours(0,0,0,0)` in the server process's zone, so on a UTC
   * host a user at UTC+3 saw their streak roll over at 03:00 local and one at
   * UTC-5 at 19:00 the evening before.
   */
  private computeStreak(stats: DailyStat[], timeZone: string): number {
    if (stats.length === 0) return 0;

    const active = new Set(
      stats
        .filter((s) => s.tasksCompleted > 0 || s.focusMinutes > 0)
        .map((s) => AnalyticsService.dayKey(s.date)),
    );
    if (active.size === 0) return 0;

    let cursor = AnalyticsService.todayInZone(timeZone);
    // A day that has not been worked yet does not end a streak; start from
    // yesterday when today is still empty.
    if (!active.has(cursor)) cursor = AnalyticsService.previousDay(cursor);

    let streak = 0;
    while (active.has(cursor)) {
      streak++;
      cursor = AnalyticsService.previousDay(cursor);
    }
    return streak;
  }

  async getAnalytics(
    workspaceId: string,
    userId: string,
    query: QueryAnalyticsDto,
  ): Promise<AnalyticsResult> {
    await assertMember(this.prisma, workspaceId, userId);

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    const dailyStats = await this.prisma.dailyStat.findMany({
      where: {
        workspaceId,
        userId,
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'asc' },
    });

    const totals = dailyStats.reduce(
      (acc, s) => ({
        tasksCompleted: acc.tasksCompleted + s.tasksCompleted,
        focusMinutes: acc.focusMinutes + s.focusMinutes,
        streak: 0,
      }),
      { tasksCompleted: 0, focusMinutes: 0, streak: 0 },
    );

    // Streak looks back past the requested range, but not without limit: this
    // ran on every dashboard load and read every DailyStat row the user had
    // ever accumulated. A streak can only span consecutive days, so a year of
    // history is far more than any streak can use.
    const [allStats, user] = await Promise.all([
      this.prisma.dailyStat.findMany({
        where: { workspaceId, userId },
        orderBy: { date: 'desc' },
        take: 400,
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      }),
    ]);

    totals.streak = this.computeStreak(allStats, user?.timezone ?? 'UTC');

    return { dailyStats, totals };
  }

  async getTeamAnalytics(
    workspaceId: string,
    requesterId: string,
    query: QueryAnalyticsDto,
  ) {
    const { role } = await assertMember(this.prisma, workspaceId, requesterId);
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException(
        'Only owner or admin can view team analytics',
      );
    }

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    const [members, grouped] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { workspaceId },
        include: {
          user: { select: { id: true, email: true, name: true, avatarUrl: true } },
        },
      }),
      this.prisma.dailyStat.groupBy({
        by: ['userId'],
        where: {
          workspaceId,
          ...(from || to
            ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
            : {}),
        },
        _sum: { tasksCompleted: true, focusMinutes: true },
      }),
    ]);

    const statsByUser = new Map(
      grouped.map((g) => [
        g.userId,
        { tasksCompleted: g._sum.tasksCompleted ?? 0, focusMinutes: g._sum.focusMinutes ?? 0 },
      ]),
    );

    return members
      .map((m) => ({
        userId: m.userId,
        user: m.user,
        role: m.role,
        tasksCompleted: statsByUser.get(m.userId)?.tasksCompleted ?? 0,
        focusMinutes: statsByUser.get(m.userId)?.focusMinutes ?? 0,
      }))
      .sort((a, b) => b.tasksCompleted - a.tasksCompleted);
  }

  async logStat(
    workspaceId: string,
    userId: string,
    dto: LogStatDto,
  ): Promise<DailyStat> {
    await assertMember(this.prisma, workspaceId, userId);

    const date = dto.date ? new Date(dto.date) : new Date();
    date.setHours(0, 0, 0, 0);

    return this.prisma.dailyStat.upsert({
      where: {
        workspaceId_userId_date: { workspaceId, userId, date },
      },
      update: {
        tasksCompleted: {
          increment: dto.tasksCompleted ?? 0,
        },
        focusMinutes: {
          increment: dto.focusMinutes ?? 0,
        },
      },
      create: {
        workspaceId,
        userId,
        date,
        tasksCompleted: dto.tasksCompleted ?? 0,
        focusMinutes: dto.focusMinutes ?? 0,
      },
    });
  }
}
