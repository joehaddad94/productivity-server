import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpush = require('web-push') as {
  setVapidDetails: jest.Mock;
  sendNotification: jest.Mock;
};

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notificationSettings: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      upsert: jest.Mock;
    };
    pushSubscription: {
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      findMany: jest.Mock;
    };
    notification: {
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let mail: jest.Mocked<Pick<MailService, 'sendNotificationEmail'>>;
  let configGet: jest.Mock;

  const USER = 'user-1';
  const WS = 'ws-1';

  const defaultSettings = {
    userId: USER,
    inApp: true,
    email: false,
    push: false,
    quietHoursStart: null,
    quietHoursEnd: null,
  };

  const buildModule = async (vapidConfigured = false) => {
    const mockPrisma = {
      notificationSettings: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
      pushSubscription: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    configGet = jest.fn().mockImplementation((key: string) => {
      if (!vapidConfigured) return undefined;
      if (key === 'VAPID_PUBLIC_KEY') return 'pub-key';
      if (key === 'VAPID_PRIVATE_KEY') return 'priv-key';
      if (key === 'VAPID_SUBJECT') return 'mailto:admin@example.com';
      return undefined;
    });

    const mockMail = { sendNotificationEmail: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMail },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get(PrismaService);
    mail = module.get(MailService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    webpush.sendNotification.mockReset();
    webpush.setVapidDetails.mockReset();
    await buildModule(false);
  });

  describe('getVapidPublicKey', () => {
    it('returns empty string when VAPID_PUBLIC_KEY is not set', () => {
      configGet.mockReturnValue(undefined);
      expect(service.getVapidPublicKey()).toBe('');
    });

    it('returns the configured VAPID public key', () => {
      configGet.mockReturnValue('my-pub-key');
      expect(service.getVapidPublicKey()).toBe('my-pub-key');
    });
  });

  describe('getSettings', () => {
    it('returns existing settings when found', async () => {
      prisma.notificationSettings.findUnique.mockResolvedValue(defaultSettings);

      const result = await service.getSettings(USER);

      expect(result).toEqual(defaultSettings);
      expect(prisma.notificationSettings.create).not.toHaveBeenCalled();
    });

    it('creates and returns settings when not found', async () => {
      prisma.notificationSettings.findUnique.mockResolvedValue(null);
      prisma.notificationSettings.create.mockResolvedValue(defaultSettings);

      const result = await service.getSettings(USER);

      expect(result).toEqual(defaultSettings);
      expect(prisma.notificationSettings.create).toHaveBeenCalledWith({
        data: { userId: USER },
      });
    });

    it('falls back to findUniqueOrThrow on create race condition', async () => {
      prisma.notificationSettings.findUnique.mockResolvedValue(null);
      prisma.notificationSettings.create.mockRejectedValue(new Error('P2002'));
      prisma.notificationSettings.findUniqueOrThrow.mockResolvedValue(
        defaultSettings,
      );

      const result = await service.getSettings(USER);

      expect(result).toEqual(defaultSettings);
    });
  });

  describe('updateSettings', () => {
    it('upserts notification settings', async () => {
      prisma.notificationSettings.upsert.mockResolvedValue({
        ...defaultSettings,
        email: true,
      });

      const result = await service.updateSettings(USER, { email: true });

      expect(result.email).toBe(true);
      expect(prisma.notificationSettings.upsert).toHaveBeenCalledWith({
        where: { userId: USER },
        create: { userId: USER, email: true },
        update: { email: true },
      });
    });
  });

  describe('savePushSubscription', () => {
    it('upserts push subscription', async () => {
      const dto = {
        endpoint: 'https://push.example.com/sub',
        p256dh: 'key-p256',
        auth: 'auth-key',
      };
      prisma.pushSubscription.upsert.mockResolvedValue({ userId: USER, ...dto });

      await service.savePushSubscription(USER, dto);

      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { userId_endpoint: { userId: USER, endpoint: dto.endpoint } },
        create: { userId: USER, ...dto },
        update: { p256dh: dto.p256dh, auth: dto.auth },
      });
    });
  });

  describe('deletePushSubscription', () => {
    it('deletes the push subscription', async () => {
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });

      await service.deletePushSubscription(USER, 'https://push.example.com/sub');

      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER, endpoint: 'https://push.example.com/sub' },
      });
    });
  });

  describe('list', () => {
    it('returns paginated notifications', async () => {
      const mockNotif = {
        id: 'n-1',
        userId: USER,
        workspaceId: WS,
        type: 'task_completed',
        title: 'Done',
        body: 'Task completed',
        read: false,
        createdAt: new Date(),
      };
      prisma.notification.findMany.mockResolvedValue([mockNotif]);
      prisma.notification.count.mockResolvedValue(1);

      const result = await service.list(USER, WS);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER, workspaceId: WS } }),
      );
    });
  });

  describe('unreadCount', () => {
    it('returns count of unread notifications', async () => {
      prisma.notification.count.mockResolvedValue(3);

      const result = await service.unreadCount(USER, WS);

      expect(result).toBe(3);
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: USER, workspaceId: WS, read: false },
      });
    });
  });

  describe('markRead', () => {
    it('marks notification as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.markRead(USER, 'n-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n-1', userId: USER },
        data: { read: true },
      });
    });
  });

  describe('markAllRead', () => {
    it('marks all workspace notifications as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      await service.markAllRead(USER, WS);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: USER, workspaceId: WS, read: false },
        data: { read: true },
      });
    });
  });

  describe('dismiss', () => {
    it('deletes a notification', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 1 });

      await service.dismiss(USER, 'n-1');

      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { id: 'n-1', userId: USER },
      });
    });
  });

  describe('dismissAll', () => {
    it('deletes all notifications for user in workspace', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 5 });

      await service.dismissAll(USER, WS);

      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER, workspaceId: WS },
      });
    });
  });

  describe('createAndDeliver', () => {
    const baseParams = {
      userId: USER,
      workspaceId: WS,
      type: 'task_completed',
      title: 'Task Done',
      body: 'A task was completed',
      userEmail: 'user@example.com',
    };

    it('creates in-app notification when inApp is true', async () => {
      prisma.notificationSettings.findUnique.mockResolvedValue({
        ...defaultSettings,
        inApp: true,
        email: false,
        push: false,
      });
      prisma.notification.create.mockResolvedValue({});

      await service.createAndDeliver(baseParams);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER,
          workspaceId: WS,
          type: 'task_completed',
          title: 'Task Done',
          body: 'A task was completed',
        }),
      });
    });

    it('skips in-app notification when inApp is false', async () => {
      prisma.notificationSettings.findUnique.mockResolvedValue({
        ...defaultSettings,
        inApp: false,
      });

      await service.createAndDeliver(baseParams);

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('skips in-app notification when skipInApp is true', async () => {
      prisma.notificationSettings.findUnique.mockResolvedValue({
        ...defaultSettings,
        inApp: true,
      });

      await service.createAndDeliver({ ...baseParams, skipInApp: true });

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('sends email notification when email is true', async () => {
      prisma.notificationSettings.findUnique.mockResolvedValue({
        ...defaultSettings,
        inApp: false,
        email: true,
      });
      (mail.sendNotificationEmail as jest.Mock).mockResolvedValue(undefined);

      await service.createAndDeliver(baseParams);

      expect(mail.sendNotificationEmail).toHaveBeenCalledWith(
        'user@example.com',
        'Task Done',
        'A task was completed',
      );
    });

    it('skips email when email setting is false', async () => {
      prisma.notificationSettings.findUnique.mockResolvedValue({
        ...defaultSettings,
        email: false,
      });

      await service.createAndDeliver(baseParams);

      expect(mail.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('skips push when VAPID is not configured', async () => {
      prisma.notificationSettings.findUnique.mockResolvedValue({
        ...defaultSettings,
        push: true,
      });

      await service.createAndDeliver(baseParams);

      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('sends push when VAPID is configured and not in quiet hours', async () => {
      await buildModule(true);
      prisma.notificationSettings.findUnique.mockResolvedValue({
        ...defaultSettings,
        inApp: false,
        push: true,
        quietHoursStart: null,
        quietHoursEnd: null,
      });
      prisma.pushSubscription.findMany.mockResolvedValue([
        {
          endpoint: 'https://push.example.com/sub',
          p256dh: 'key',
          auth: 'auth',
        },
      ]);
      webpush.sendNotification.mockResolvedValue(undefined);

      await service.createAndDeliver(baseParams);

      expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
      expect(webpush.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'https://push.example.com/sub' }),
        expect.any(String),
      );
    });

    it('removes expired push subscription (410) and continues', async () => {
      await buildModule(true);
      prisma.notificationSettings.findUnique.mockResolvedValue({
        ...defaultSettings,
        inApp: false,
        push: true,
        quietHoursStart: null,
        quietHoursEnd: null,
      });
      const sub = {
        endpoint: 'https://push.example.com/expired',
        p256dh: 'k',
        auth: 'a',
      };
      prisma.pushSubscription.findMany.mockResolvedValue([sub]);
      const err = Object.assign(new Error('Gone'), { statusCode: 410 });
      webpush.sendNotification.mockRejectedValue(err);
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });

      await service.createAndDeliver(baseParams);

      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER, endpoint: sub.endpoint },
      });
    });
  });
});
