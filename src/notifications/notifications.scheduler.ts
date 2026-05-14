import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TaskStatusesService } from '../task-statuses/task-statuses.service';
import { NotificationsService } from './notifications.service';
import { buildTaskVisibilityWhere } from '../tasks/task-visibility';
import type { WorkspaceRole } from '../common/assert-member';

function getLocalHour(timezone: string | null | undefined): number {
  const tz = timezone ?? 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const h = parts.find((p) => p.type === 'hour')?.value ?? '0';
    return parseInt(h, 10) % 24;
  } catch {
    return new Date().getUTCHours();
  }
}

function parseHour(hhmm: string): number {
  return parseInt(hhmm.split(':')[0] ?? '8', 10);
}

/** Returns UTC-midnight Date objects that represent today/tomorrow in the user's local timezone. */
function getLocalDayBoundaries(timezone: string | null | undefined): {
  today: Date;
  tomorrow: Date;
} {
  const tz = timezone ?? 'UTC';
  try {
    // 'en-CA' locale uses YYYY-MM-DD format which is easy to parse
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const today = new Date(dateStr + 'T00:00:00Z');
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return { today, tomorrow };
  } catch {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return { today, tomorrow };
  }
}

@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly taskStatuses: TaskStatusesService,
  ) {}

  /** Runs every hour — dispatches per-user jobs based on their local time */
  @Cron('0 * * * *')
  async hourlyDispatch() {
    this.logger.log('Hourly notification dispatch running');

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspace: { deletedAt: null } },
      include: { user: true, workspace: true },
    });

    for (const member of members) {
      const settings = await this.notifications.getSettings(member.userId);
      if (!settings.inApp && !settings.email && !settings.push) continue;

      const localHour = getLocalHour(member.user.timezone);
      const agendaHour = parseHour(settings.dailyAgendaTime ?? '08:00');

      if (localHour === agendaHour) {
        await this.runDailyAgenda(member);
      }
      if (localHour === 9) {
        await this.runOverdueCheck(member);
      }
      if (localHour === 14) {
        await this.runDueTodayReminder(member);
      }
    }
  }

  private async runDailyAgenda(member: {
    userId: string;
    workspaceId: string;
    role: string;
    canSeeAllTasks: boolean;
    user: { email: string; timezone: string | null };
  }) {
    const { today, tomorrow } = getLocalDayBoundaries(member.user.timezone);

    // Dedup: skip if daily_agenda already sent today for this user/workspace
    const existing = await this.prisma.notification.findFirst({
      where: {
        userId: member.userId,
        workspaceId: member.workspaceId,
        type: 'daily_agenda',
        createdAt: { gte: today },
      },
    });
    if (existing) return;

    const terminalIds = await this.taskStatuses.terminalStatusIds(
      member.workspaceId,
    );
    const notDone =
      terminalIds.length > 0 ? { status: { notIn: terminalIds } } : {};
    const visibility = buildTaskVisibilityWhere(
      member.userId,
      member.role as WorkspaceRole,
      member.canSeeAllTasks,
    );

    const [dueTodayCount, overdueCount] = await Promise.all([
      this.prisma.task.count({
        where: {
          workspaceId: member.workspaceId,
          dueDate: { gte: today, lt: tomorrow },
          ...notDone,
          deletedAt: null,
          ...visibility,
        },
      }),
      this.prisma.task.count({
        where: {
          workspaceId: member.workspaceId,
          dueDate: { lt: today },
          ...notDone,
          deletedAt: null,
          ...visibility,
        },
      }),
    ]);

    if (dueTodayCount === 0 && overdueCount === 0) return;

    const parts: string[] = [];
    if (dueTodayCount > 0)
      parts.push(
        `${dueTodayCount} task${dueTodayCount > 1 ? 's' : ''} due today`,
      );
    if (overdueCount > 0) parts.push(`${overdueCount} overdue`);

    await this.notifications.createAndDeliver({
      userId: member.userId,
      workspaceId: member.workspaceId,
      type: 'daily_agenda',
      title: 'Daily Agenda',
      body: parts.join(' · '),
      userEmail: member.user.email,
      userTimezone: member.user.timezone,
    });
  }

  private async runOverdueCheck(member: {
    userId: string;
    workspaceId: string;
    role: string;
    canSeeAllTasks: boolean;
    user: { email: string; timezone: string | null };
  }) {
    const { today } = getLocalDayBoundaries(member.user.timezone);

    const terminalIds = await this.taskStatuses.terminalStatusIds(
      member.workspaceId,
    );
    const notDone =
      terminalIds.length > 0 ? { status: { notIn: terminalIds } } : {};
    const visibility = buildTaskVisibilityWhere(
      member.userId,
      member.role as WorkspaceRole,
      member.canSeeAllTasks,
    );

    const overdueTasks = await this.prisma.task.findMany({
      where: {
        workspaceId: member.workspaceId,
        dueDate: { lt: today },
        ...notDone,
        deletedAt: null,
        ...visibility,
      },
      take: 5,
      orderBy: { dueDate: 'asc' },
    });

    for (const task of overdueTasks) {
      const existingToday = await this.prisma.notification.findFirst({
        where: {
          userId: member.userId,
          taskId: task.id,
          type: 'overdue',
          createdAt: { gte: today },
        },
      });
      if (existingToday) continue;

      await this.notifications.createAndDeliver({
        userId: member.userId,
        workspaceId: member.workspaceId,
        taskId: task.id,
        type: 'overdue',
        title: 'Overdue Task',
        body: `"${task.title}" is past its due date`,
        userEmail: member.user.email,
        userTimezone: member.user.timezone,
        url: `/tasks`,
      });
    }
  }

  private async runDueTodayReminder(member: {
    userId: string;
    workspaceId: string;
    role: string;
    canSeeAllTasks: boolean;
    user: { email: string; timezone: string | null };
  }) {
    const { today, tomorrow } = getLocalDayBoundaries(member.user.timezone);

    const terminalIds = await this.taskStatuses.terminalStatusIds(
      member.workspaceId,
    );
    const notDone =
      terminalIds.length > 0 ? { status: { notIn: terminalIds } } : {};
    const visibility = buildTaskVisibilityWhere(
      member.userId,
      member.role as WorkspaceRole,
      member.canSeeAllTasks,
    );

    const dueTasks = await this.prisma.task.findMany({
      where: {
        workspaceId: member.workspaceId,
        dueDate: { gte: today, lt: tomorrow },
        ...notDone,
        deletedAt: null,
        ...visibility,
      },
      take: 5,
      orderBy: { priority: 'desc' },
    });

    for (const task of dueTasks) {
      const existingToday = await this.prisma.notification.findFirst({
        where: {
          userId: member.userId,
          taskId: task.id,
          type: 'due_today',
          createdAt: { gte: today },
        },
      });
      if (existingToday) continue;

      await this.notifications.createAndDeliver({
        userId: member.userId,
        workspaceId: member.workspaceId,
        taskId: task.id,
        type: 'due_today',
        title: 'Due Today',
        body: `"${task.title}" is due today`,
        userEmail: member.user.email,
        userTimezone: member.user.timezone,
        url: `/tasks`,
      });
    }
  }
}
