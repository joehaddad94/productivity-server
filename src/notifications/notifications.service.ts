import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { UpdateNotificationSettingsDto } from './dto/notification-settings.dto';
import { SavePushSubscriptionDto } from './dto/push-subscription.dto';

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

function isInQuietHours(
  start: string | null,
  end: string | null,
  timezone: string | null | undefined,
): boolean {
  if (!start || !end) return false;
  const localHour = getLocalHour(timezone);
  const startH = parseInt(start.split(':')[0] ?? '0', 10);
  const endH = parseInt(end.split(':')[0] ?? '0', 10);
  if (startH === endH) return false;
  // Handle overnight ranges (e.g., 22:00 → 08:00)
  if (startH > endH) return localHour >= startH || localHour < endH;
  return localHour >= startH && localHour < endH;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private vapidConfigured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT');
    if (publicKey && privateKey && subject) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidConfigured = true;
    } else {
      this.logger.warn(
        'VAPID keys not configured — push notifications disabled',
      );
    }
  }

  getVapidPublicKey(): string {
    return this.config.get<string>('VAPID_PUBLIC_KEY') ?? '';
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  async getSettings(userId: string) {
    const existing = await this.prisma.notificationSettings.findUnique({
      where: { userId },
    });
    if (existing) return existing;
    try {
      return await this.prisma.notificationSettings.create({
        data: { userId },
      });
    } catch {
      return this.prisma.notificationSettings.findUniqueOrThrow({
        where: { userId },
      });
    }
  }

  async updateSettings(userId: string, dto: UpdateNotificationSettingsDto) {
    return this.prisma.notificationSettings.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  // ── Push subscriptions ────────────────────────────────────────────────────

  async savePushSubscription(userId: string, dto: SavePushSubscriptionDto) {
    return this.prisma.pushSubscription.upsert({
      where: { userId_endpoint: { userId, endpoint: dto.endpoint } },
      create: { userId, ...dto },
      update: { p256dh: dto.p256dh, auth: dto.auth },
    });
  }

  async deletePushSubscription(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
  }

  // ── Notification CRUD ─────────────────────────────────────────────────────

  async list(userId: string, workspaceId: string, skip = 0, take = 50) {
    const where = { userId, workspaceId };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total };
  }

  async unreadCount(userId: string, workspaceId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, workspaceId, read: false },
    });
  }

  async markRead(userId: string, id: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  async markAllRead(userId: string, workspaceId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, workspaceId, read: false },
      data: { read: true },
    });
  }

  async dismiss(userId: string, id: string) {
    await this.prisma.notification.deleteMany({ where: { id, userId } });
  }

  async dismissAll(userId: string, workspaceId: string) {
    await this.prisma.notification.deleteMany({
      where: { userId, workspaceId },
    });
  }

  // ── Delivery ──────────────────────────────────────────────────────────────

  async createAndDeliver(params: {
    userId: string;
    workspaceId: string;
    taskId?: string;
    type: string;
    title: string;
    body: string;
    userEmail: string;
    userTimezone?: string | null;
    url?: string;
    skipInApp?: boolean;
  }) {
    const settings = await this.getSettings(params.userId);

    if (settings.inApp && !params.skipInApp && params.workspaceId) {
      await this.prisma.notification.create({
        data: {
          userId: params.userId,
          workspaceId: params.workspaceId,
          taskId: params.taskId ?? null,
          type: params.type,
          title: params.title,
          body: params.body,
        },
      });
    }

    if (settings.email) {
      await this.mail.sendNotificationEmail(
        params.userEmail,
        params.title,
        params.body,
      );
    }

    if (settings.push && this.vapidConfigured) {
      const inQuiet = isInQuietHours(
        settings.quietHoursStart ?? null,
        settings.quietHoursEnd ?? null,
        params.userTimezone,
      );
      if (!inQuiet) {
        await this.sendPush(
          params.userId,
          params.title,
          params.body,
          params.url,
        );
      }
    }
  }

  private async sendPush(
    userId: string,
    title: string,
    body: string,
    url?: string,
  ) {
    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    const payload = JSON.stringify({ title, body, url: url ?? '/dashboard' });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          await this.prisma.pushSubscription.deleteMany({
            where: { userId, endpoint: sub.endpoint },
          });
        } else {
          this.logger.error(
            `Push failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }
}
