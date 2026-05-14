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

  private computeStreak(stats: DailyStat[]): number {
    if (stats.length === 0) return 0;

    // Sort descending by date
    const sorted = [...stats].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let streak = 0;
    let cursor = new Date(today);

    for (const stat of sorted) {
      const statDate = new Date(stat.date);
      statDate.setHours(0, 0, 0, 0);

      const diff =
        (cursor.getTime() - statDate.getTime()) / (1000 * 60 * 60 * 24);

      if (diff > 1) break;
      if (diff === 0 || diff === 1) {
        if (stat.tasksCompleted > 0 || stat.focusMinutes > 0) {
          streak++;
          cursor = statDate;
        } else {
          break;
        }
      }
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

    // Streak is computed over all stats for this user+workspace (not just the range)
    const allStats = await this.prisma.dailyStat.findMany({
      where: { workspaceId, userId },
      orderBy: { date: 'desc' },
    });

    totals.streak = this.computeStreak(allStats);

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
