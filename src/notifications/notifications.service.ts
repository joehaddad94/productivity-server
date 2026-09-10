import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SseService } from '../sse/sse.service';
import { UpdateNotificationSettingsDto } from './dto/notification-settings.dto';
import { SavePushSubscriptionDto } from './dto/push-subscription.dto';

/** Minutes since local midnight in the given IANA zone. */
function getLocalMinutes(timezone: string | null | undefined): number {
  const tz = timezone ?? 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    return (h % 24) * 60 + m;
  } catch {
    const now = new Date();
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/** "HH:MM" to minutes since midnight, or null if unparseable. */
function toMinutes(hhmm: string): number | null {
  const [rawH, rawM] = hhmm.split(':');
  const h = parseInt(rawH ?? '', 10);
  if (Number.isNaN(h)) return null;
  const m = parseInt(rawM ?? '0', 10);
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

function isInQuietHours(
  start: string | null,
  end: string | null,
  timezone: string | null | undefined,
): boolean {
  if (!start || !end) return false;
  // Compare at minute resolution. Only the hour used to be parsed, so a quiet
  // window of 22:30 behaved as 22:00, and `startH === endH` disabled any
  // window inside a single hour (22:00–22:45) entirely — while Settings
  // presents both as free time inputs.
  const startM = toMinutes(start);
  const endM = toMinutes(end);
  if (startM === null || endM === null || startM === endM) return false;

  const nowM = getLocalMinutes(timezone);
  // Overnight ranges (e.g. 22:00 -> 08:00) wrap past midnight.
  if (startM > endM) return nowM >= startM || nowM < endM;
  return nowM >= startM && nowM < endM;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private vapidConfigured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly sse: SseService,
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
      // Tell open tabs a notification landed. The bell used to poll every 30
      // seconds to find this out, on a connection that was already open.
      this.sse.emit(params.workspaceId, { type: 'notifications_changed' });
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
