import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CalendarConnectionsService } from './calendar-connections.service';
import { PrismaService } from '../prisma/prisma.service';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('CalendarConnectionsService', () => {
  let service: CalendarConnectionsService;
  let prisma: {
    calendarConnection: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
      update: jest.Mock;
    };
  };
  let configGet: jest.Mock;

  const USER = 'user-1';

  const buildModule = async (configValues: Record<string, string> = {}) => {
    const mockPrisma = {
      calendarConnection: {
        upsert: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
      },
    };

    configGet = jest
      .fn()
      .mockImplementation((key: string) => configValues[key]);
    const configGetOrThrow = jest.fn().mockImplementation((key: string) => {
      const val = configValues[key];
      if (!val) throw new Error(`Missing config: ${key}`);
      return val;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarConnectionsService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: ConfigService,
          useValue: { get: configGet, getOrThrow: configGetOrThrow },
        },
      ],
    }).compile();

    service = module.get<CalendarConnectionsService>(
      CalendarConnectionsService,
    );
    prisma = module.get(PrismaService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await buildModule({
      JWT_SECRET: 'test-secret-32-chars-long-enough',
      GOOGLE_CALENDAR_CLIENT_ID: 'google-client-id',
      GOOGLE_CALENDAR_REDIRECT_URI: 'https://app.example.com/google/callback',
      GOOGLE_CALENDAR_CLIENT_SECRET: 'google-secret',
      MICROSOFT_CLIENT_ID: 'ms-client-id',
      MICROSOFT_REDIRECT_URI: 'https://app.example.com/ms/callback',
      MICROSOFT_CLIENT_SECRET: 'ms-secret',
    });
  });

  describe('verifyOAuthState', () => {
    it('returns userId for a valid state', () => {
      const state = (
        service as unknown as {
          signOAuthState: (id: string) => string;
        }
      ).signOAuthState(USER);

      const result = service.verifyOAuthState(state);

      expect(result).toBe(USER);
    });

    it('throws BadRequestException for bad base64', () => {
      expect(() => service.verifyOAuthState('!!!not-base64')).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for tampered signature', () => {
      const validState = (
        service as unknown as {
          signOAuthState: (id: string) => string;
        }
      ).signOAuthState(USER);
      // Replace last character to tamper with signature; pick a character
      // guaranteed to differ so the test can't pass by coincidence
      const lastChar = validState.slice(-1);
      const tampered = validState.slice(0, -1) + (lastChar === 'x' ? 'y' : 'x');

      expect(() => service.verifyOAuthState(tampered)).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for expired state (>10 min old)', () => {
      // Build a state with a timestamp 11 minutes in the past
      const secret = 'test-secret-32-chars-long-enough';
      const oldTs = Date.now() - 11 * 60 * 1000;
      const payload = `${USER}:${oldTs}`;
      const { createHmac } = require('crypto') as typeof import('crypto');
      const sig = createHmac('sha256', secret).update(payload).digest('hex');
      const state = Buffer.from(`${payload}:${sig}`).toString('base64url');

      expect(() => service.verifyOAuthState(state)).toThrow(
        'OAuth state expired',
      );
    });
  });

  describe('getGoogleAuthUrl', () => {
    it('throws BadRequestException when Google Calendar is not configured', async () => {
      await buildModule({ JWT_SECRET: 'secret' });

      expect(() => service.getGoogleAuthUrl(USER)).toThrow(BadRequestException);
      expect(() => service.getGoogleAuthUrl(USER)).toThrow(
        'Google Calendar is not configured',
      );
    });

    it('returns Google OAuth URL with all required params', () => {
      const url = service.getGoogleAuthUrl(USER);

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('client_id=google-client-id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('state=');
    });
  });

  describe('getMicrosoftAuthUrl', () => {
    it('throws BadRequestException when Microsoft Calendar is not configured', async () => {
      await buildModule({ JWT_SECRET: 'secret' });

      expect(() => service.getMicrosoftAuthUrl(USER)).toThrow(
        BadRequestException,
      );
      expect(() => service.getMicrosoftAuthUrl(USER)).toThrow(
        'Microsoft Calendar is not configured',
      );
    });

    it('returns Microsoft OAuth URL with all required params', () => {
      const url = service.getMicrosoftAuthUrl(USER);

      expect(url).toContain(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      );
      expect(url).toContain('client_id=ms-client-id');
      expect(url).toContain('response_type=code');
      expect(url).toContain('state=');
    });
  });

  describe('handleGoogleCallback', () => {
    it('throws BadRequestException when token exchange fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('invalid_grant'),
      });

      await expect(
        service.handleGoogleCallback(USER, 'bad-code'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.handleGoogleCallback(USER, 'bad-code'),
      ).rejects.toThrow('Google token exchange failed');
    });

    it('upserts Google calendar connection on success', async () => {
      const tokens = {
        access_token: 'acc-tok',
        refresh_token: 'ref-tok',
        expires_in: 3600,
        token_type: 'Bearer',
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(tokens),
      });
      prisma.calendarConnection.upsert.mockResolvedValue({});

      await service.handleGoogleCallback(USER, 'valid-code');

      expect(prisma.calendarConnection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_provider: { userId: USER, provider: 'google' } },
          create: expect.objectContaining({
            userId: USER,
            provider: 'google',
            accessToken: 'acc-tok',
            refreshToken: 'ref-tok',
          }),
          update: expect.objectContaining({ accessToken: 'acc-tok' }),
        }),
      );
    });

    it('stores null refreshToken when not returned', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'acc',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
      });
      prisma.calendarConnection.upsert.mockResolvedValue({});

      await service.handleGoogleCallback(USER, 'code');

      expect(prisma.calendarConnection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ refreshToken: null }),
        }),
      );
    });
  });

  describe('handleMicrosoftCallback', () => {
    it('throws BadRequestException when token exchange fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('unauthorized_client'),
      });

      await expect(
        service.handleMicrosoftCallback(USER, 'bad-code'),
      ).rejects.toThrow('Microsoft token exchange failed');
    });

    it('upserts Microsoft calendar connection on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'ms-acc',
            refresh_token: 'ms-ref',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
      });
      prisma.calendarConnection.upsert.mockResolvedValue({});

      await service.handleMicrosoftCallback(USER, 'valid-code');

      expect(prisma.calendarConnection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_provider: { userId: USER, provider: 'microsoft' } },
          create: expect.objectContaining({
            provider: 'microsoft',
            accessToken: 'ms-acc',
          }),
        }),
      );
    });
  });

  describe('listConnections', () => {
    it('returns calendar connections for user', async () => {
      const connections = [
        {
          id: 'conn-1',
          provider: 'google',
          createdAt: new Date(),
          expiresAt: new Date(),
        },
      ];
      prisma.calendarConnection.findMany.mockResolvedValue(connections);

      const result = await service.listConnections(USER);

      expect(result).toEqual(connections);
      expect(prisma.calendarConnection.findMany).toHaveBeenCalledWith({
        where: { userId: USER },
        select: { id: true, provider: true, createdAt: true, expiresAt: true },
      });
    });

    it('returns empty array when no connections', async () => {
      prisma.calendarConnection.findMany.mockResolvedValue([]);

      const result = await service.listConnections(USER);

      expect(result).toEqual([]);
    });
  });

  describe('disconnect', () => {
    it('throws NotFoundException when connection does not exist', async () => {
      prisma.calendarConnection.findUnique.mockResolvedValue(null);

      await expect(service.disconnect(USER, 'google')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.disconnect(USER, 'google')).rejects.toThrow(
        'Calendar connection not found',
      );

      expect(prisma.calendarConnection.delete).not.toHaveBeenCalled();
    });

    it('deletes connection when found', async () => {
      prisma.calendarConnection.findUnique.mockResolvedValue({ id: 'conn-1' });
      prisma.calendarConnection.delete.mockResolvedValue({});

      await service.disconnect(USER, 'google');

      expect(prisma.calendarConnection.delete).toHaveBeenCalledWith({
        where: { userId_provider: { userId: USER, provider: 'google' } },
      });
    });
  });

  describe('getEvents', () => {
    const futureExpiry = new Date(Date.now() + 10 * 60 * 1000);

    it('returns empty array when no connections', async () => {
      prisma.calendarConnection.findMany.mockResolvedValue([]);

      const result = await service.getEvents(USER, '2026-05-01', '2026-05-31');

      expect(result).toEqual([]);
    });

    it('returns google events mapped to CalendarEvent shape', async () => {
      prisma.calendarConnection.findMany.mockResolvedValue([
        {
          id: 'conn-1',
          userId: USER,
          provider: 'google',
          accessToken: 'tok',
          refreshToken: null,
          expiresAt: futureExpiry,
        },
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 'g-1',
                summary: 'Team Meeting',
                start: { dateTime: '2026-05-10T10:00:00Z' },
                end: { dateTime: '2026-05-10T11:00:00Z' },
                htmlLink: 'https://calendar.google.com/event/1',
              },
            ],
          }),
      });

      const result = await service.getEvents(USER, '2026-05-01', '2026-05-31');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'google-g-1',
        title: 'Team Meeting',
        allDay: false,
        provider: 'google',
        url: 'https://calendar.google.com/event/1',
      });
    });

    it('returns microsoft events mapped to CalendarEvent shape', async () => {
      prisma.calendarConnection.findMany.mockResolvedValue([
        {
          id: 'conn-2',
          userId: USER,
          provider: 'microsoft',
          accessToken: 'ms-tok',
          refreshToken: null,
          expiresAt: futureExpiry,
        },
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            value: [
              {
                id: 'ms-1',
                subject: 'Standup',
                start: { dateTime: '2026-05-10T09:00:00Z' },
                end: { dateTime: '2026-05-10T09:30:00Z' },
                isAllDay: false,
                webLink: 'https://outlook.office.com/event/1',
              },
            ],
          }),
      });

      const result = await service.getEvents(USER, '2026-05-01', '2026-05-31');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'microsoft-ms-1',
        title: 'Standup',
        allDay: false,
        provider: 'microsoft',
      });
    });

    it('skips failed connections and returns events from succeeded ones', async () => {
      prisma.calendarConnection.findMany.mockResolvedValue([
        {
          id: 'conn-1',
          userId: USER,
          provider: 'google',
          accessToken: 'tok',
          refreshToken: null,
          expiresAt: futureExpiry,
        },
        {
          id: 'conn-2',
          userId: USER,
          provider: 'microsoft',
          accessToken: 'ms-tok',
          refreshToken: null,
          expiresAt: futureExpiry,
        },
      ]);

      // Google fetch succeeds, Microsoft fetch fails
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ items: [] }),
        })
        .mockResolvedValueOnce({ ok: false });

      const result = await service.getEvents(USER, '2026-05-01', '2026-05-31');

      expect(result).toEqual([]);
    });

    it('marks all-day google events correctly', async () => {
      prisma.calendarConnection.findMany.mockResolvedValue([
        {
          id: 'conn-1',
          userId: USER,
          provider: 'google',
          accessToken: 'tok',
          refreshToken: null,
          expiresAt: futureExpiry,
        },
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                id: 'g-2',
                summary: 'Holiday',
                start: { date: '2026-05-10' },
                end: { date: '2026-05-11' },
              },
            ],
          }),
      });

      const result = await service.getEvents(USER, '2026-05-01', '2026-05-31');

      expect(result[0].allDay).toBe(true);
    });
  });
});
