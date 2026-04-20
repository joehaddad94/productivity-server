import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TaskStatusesService } from '../task-statuses/task-statuses.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly taskStatuses: TaskStatusesService,
  ) {}

  /** Daily agenda — every day at 08:00 UTC */
  @Cron('0 8 * * *')
  async dailyAgenda() {
    this.logger.log('Running daily agenda notifications');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const members = await this.prisma.workspaceMember.findMany({
      include: { user: true, workspace: true },
    });

    for (const member of members) {
      const settings = await this.notifications.getSettings(member.userId);
      if (!settings.inApp && !settings.email && !settings.push) continue;

      const terminalIds = await this.taskStatuses.terminalStatusIds(member.workspaceId);
      const notDone =
        terminalIds.length > 0 ? { status: { notIn: terminalIds } } : {};

      const dueTodayCount = await this.prisma.task.count({
        where: {
          workspaceId: member.workspaceId,
          dueDate: { gte: today, lt: tomorrow },
          ...notDone,
          deletedAt: null,
        },
      });

      const overdueCount = await this.prisma.task.count({
        where: {
          workspaceId: member.workspaceId,
          dueDate: { lt: today },
          ...notDone,
          deletedAt: null,
        },
      });

      if (dueTodayCount === 0 && overdueCount === 0) continue;

      const parts: string[] = [];
      if (dueTodayCount > 0) parts.push(`${dueTodayCount} task${dueTodayCount > 1 ? 's' : ''} due today`);
      if (overdueCount > 0) parts.push(`${overdueCount} overdue task${overdueCount > 1 ? 's' : ''}`);

      await this.notifications.createAndDeliver({
        userId: member.userId,
        workspaceId: member.workspaceId,
        type: 'daily_agenda',
        title: 'Daily Agenda',
        body: parts.join(' · '),
        userEmail: member.user.email,
      });
    }
  }

  /** Overdue check — every day at 09:00 UTC */
  @Cron('0 9 * * *')
  async overdueCheck() {
    this.logger.log('Running overdue task notifications');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const members = await this.prisma.workspaceMember.findMany({
      include: { user: true },
    });

    for (const member of members) {
      const settings = await this.notifications.getSettings(member.userId);
      if (!settings.inApp && !settings.email && !settings.push) continue;

      const terminalIds = await this.taskStatuses.terminalStatusIds(member.workspaceId);
      const notDone =
        terminalIds.length > 0 ? { status: { notIn: terminalIds } } : {};

      const overdueTasks = await this.prisma.task.findMany({
        where: {
          workspaceId: member.workspaceId,
          dueDate: { lt: today },
          ...notDone,
          deletedAt: null,
        },
        take: 5,
        orderBy: { dueDate: 'asc' },
      });

      for (const task of overdueTasks) {
        // Avoid duplicate notifications: skip if one was sent for this task today
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
        });
      }
    }
  }

  /** Due-today reminder — every day at 14:00 UTC (afternoon nudge) */
  @Cron('0 14 * * *')
  async dueTodayReminder() {
    this.logger.log('Running due-today reminder notifications');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const members = await this.prisma.workspaceMember.findMany({
      include: { user: true },
    });

    for (const member of members) {
      const settings = await this.notifications.getSettings(member.userId);
      if (!settings.inApp && !settings.email && !settings.push) continue;

      const terminalIds = await this.taskStatuses.terminalStatusIds(member.workspaceId);
      const notDone =
        terminalIds.length > 0 ? { status: { notIn: terminalIds } } : {};

      const dueTasks = await this.prisma.task.findMany({
        where: {
          workspaceId: member.workspaceId,
          dueDate: { gte: today, lt: tomorrow },
          ...notDone,
          deletedAt: null,
        },
        take: 5,
        orderBy: { priority: 'desc' },
      });

      if (dueTasks.length === 0) continue;

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
        });
      }
    }
  }
}
