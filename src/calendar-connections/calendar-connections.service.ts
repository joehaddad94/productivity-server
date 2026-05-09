import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  provider: 'google' | 'microsoft';
  url?: string;
}

@Injectable()
export class CalendarConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ─── State signing (replaces cookie auth on callback) ────────────────────

  private signOAuthState(userId: string): string {
    const secret = this.config.getOrThrow<string>('JWT_SECRET');
    const payload = `${userId}:${Date.now()}`;
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    return Buffer.from(`${payload}:${sig}`).toString('base64url');
  }

  verifyOAuthState(state: string): string {
    try {
      const decoded = Buffer.from(state, 'base64url').toString('utf8');
      const lastColon = decoded.lastIndexOf(':');
      const payload = decoded.slice(0, lastColon);
      const sig = decoded.slice(lastColon + 1);
      const secret = this.config.getOrThrow<string>('JWT_SECRET');
      const expected = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
      if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        throw new Error('bad sig');
      }
      const [userId, tsStr] = payload.split(':');
      if (Date.now() - parseInt(tsStr, 10) > 10 * 60 * 1000) {
        throw new BadRequestException(
          'OAuth state expired — please try connecting again',
        );
      }
      return userId;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException('Invalid OAuth state');
    }
  }

  // ─── OAuth URLs ───────────────────────────────────────────────────────────

  getGoogleAuthUrl(userId: string): string {
    const clientId = this.config.get<string>('GOOGLE_CALENDAR_CLIENT_ID');
    const redirectUri = this.config.get<string>('GOOGLE_CALENDAR_REDIRECT_URI');
    if (!clientId || !redirectUri) {
      throw new BadRequestException('Google Calendar is not configured');
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state: this.signOAuthState(userId),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  getMicrosoftAuthUrl(userId: string): string {
    const clientId = this.config.get<string>('MICROSOFT_CLIENT_ID');
    const redirectUri = this.config.get<string>('MICROSOFT_REDIRECT_URI');
    if (!clientId || !redirectUri) {
      throw new BadRequestException('Microsoft Calendar is not configured');
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'Calendars.Read offline_access',
      response_mode: 'query',
      state: this.signOAuthState(userId),
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
  }

  // ─── OAuth Callbacks ──────────────────────────────────────────────────────

  async handleGoogleCallback(userId: string, code: string): Promise<void> {
    const clientId = this.config.get<string>('GOOGLE_CALENDAR_CLIENT_ID');
    const clientSecret = this.config.get<string>(
      'GOOGLE_CALENDAR_CLIENT_SECRET',
    );
    const redirectUri = this.config.get<string>('GOOGLE_CALENDAR_REDIRECT_URI');

    const body = new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri!,
      grant_type: 'authorization_code',
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new BadRequestException(`Google token exchange failed: ${err}`);
    }

    const tokens = (await res.json()) as GoogleTokenResponse;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await this.prisma.calendarConnection.upsert({
      where: { userId_provider: { userId, provider: 'google' } },
      create: {
        userId,
        provider: 'google',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? undefined,
        expiresAt,
      },
    });
  }

  async handleMicrosoftCallback(userId: string, code: string): Promise<void> {
    const clientId = this.config.get<string>('MICROSOFT_CLIENT_ID');
    const clientSecret = this.config.get<string>('MICROSOFT_CLIENT_SECRET');
    const redirectUri = this.config.get<string>('MICROSOFT_REDIRECT_URI');

    const body = new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri!,
      grant_type: 'authorization_code',
      scope: 'Calendars.Read offline_access',
    });

    const res = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new BadRequestException(`Microsoft token exchange failed: ${err}`);
    }

    const tokens = (await res.json()) as MicrosoftTokenResponse;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await this.prisma.calendarConnection.upsert({
      where: { userId_provider: { userId, provider: 'microsoft' } },
      create: {
        userId,
        provider: 'microsoft',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? undefined,
        expiresAt,
      },
    });
  }

  // ─── List connections ─────────────────────────────────────────────────────

  async listConnections(userId: string) {
    const connections = await this.prisma.calendarConnection.findMany({
      where: { userId },
      select: { id: true, provider: true, createdAt: true, expiresAt: true },
    });
    return connections;
  }

  // ─── Disconnect ───────────────────────────────────────────────────────────

  async disconnect(userId: string, provider: string): Promise<void> {
    const conn = await this.prisma.calendarConnection.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!conn) throw new NotFoundException('Calendar connection not found');
    await this.prisma.calendarConnection.delete({
      where: { userId_provider: { userId, provider } },
    });
  }

  // ─── Fetch events ─────────────────────────────────────────────────────────

  async getEvents(
    userId: string,
    start: string,
    end: string,
  ): Promise<CalendarEvent[]> {
    const connections = await this.prisma.calendarConnection.findMany({
      where: { userId },
    });

    const results = await Promise.allSettled(
      connections.map((conn) => {
        if (conn.provider === 'google') {
          return this.fetchGoogleEvents(conn, userId, start, end);
        } else {
          return this.fetchMicrosoftEvents(conn, userId, start, end);
        }
      }),
    );

    const events: CalendarEvent[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') events.push(...r.value);
    }
    return events;
  }

  // ─── Google events ────────────────────────────────────────────────────────

  private async fetchGoogleEvents(
    conn: {
      id: string;
      provider: string;
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date | null;
      userId: string;
    },
    userId: string,
    start: string,
    end: string,
  ): Promise<CalendarEvent[]> {
    const token = await this.refreshGoogleTokenIfNeeded(conn, userId);
    const params = new URLSearchParams({
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) return [];

    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        htmlLink?: string;
      }>;
    };

    return (data.items ?? []).map((item) => ({
      id: `google-${item.id}`,
      title: item.summary ?? '(No title)',
      start: item.start?.dateTime ?? item.start?.date ?? start,
      end: item.end?.dateTime ?? item.end?.date ?? end,
      allDay: !item.start?.dateTime,
      provider: 'google' as const,
      url: item.htmlLink,
    }));
  }

  private async refreshGoogleTokenIfNeeded(
    conn: {
      id: string;
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date | null;
      userId: string;
    },
    userId: string,
  ): Promise<string> {
    if (!conn.expiresAt || conn.expiresAt > new Date(Date.now() + 60_000)) {
      return conn.accessToken;
    }
    if (!conn.refreshToken) return conn.accessToken;

    const clientId = this.config.get<string>('GOOGLE_CALENDAR_CLIENT_ID');
    const clientSecret = this.config.get<string>(
      'GOOGLE_CALENDAR_CLIENT_SECRET',
    );

    const body = new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: conn.refreshToken,
      grant_type: 'refresh_token',
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) return conn.accessToken;

    const tokens = (await res.json()) as GoogleTokenResponse;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await this.prisma.calendarConnection.update({
      where: { userId_provider: { userId, provider: 'google' } },
      data: { accessToken: tokens.access_token, expiresAt },
    });

    return tokens.access_token;
  }

  // ─── Microsoft events ─────────────────────────────────────────────────────

  private async fetchMicrosoftEvents(
    conn: {
      id: string;
      provider: string;
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date | null;
      userId: string;
    },
    userId: string,
    start: string,
    end: string,
  ): Promise<CalendarEvent[]> {
    const token = await this.refreshMicrosoftTokenIfNeeded(conn, userId);
    const params = new URLSearchParams({
      startDateTime: new Date(start).toISOString(),
      endDateTime: new Date(end).toISOString(),
      $top: '250',
      $select: 'id,subject,start,end,isAllDay,webLink',
      $orderby: 'start/dateTime',
    });

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) return [];

    const data = (await res.json()) as {
      value?: Array<{
        id: string;
        subject?: string;
        start?: { dateTime?: string; timeZone?: string };
        end?: { dateTime?: string; timeZone?: string };
        isAllDay?: boolean;
        webLink?: string;
      }>;
    };

    return (data.value ?? []).map((item) => ({
      id: `microsoft-${item.id}`,
      title: item.subject ?? '(No title)',
      start: item.start?.dateTime ?? start,
      end: item.end?.dateTime ?? end,
      allDay: item.isAllDay ?? false,
      provider: 'microsoft' as const,
      url: item.webLink,
    }));
  }

  private async refreshMicrosoftTokenIfNeeded(
    conn: {
      id: string;
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date | null;
      userId: string;
    },
    userId: string,
  ): Promise<string> {
    if (!conn.expiresAt || conn.expiresAt > new Date(Date.now() + 60_000)) {
      return conn.accessToken;
    }
    if (!conn.refreshToken) return conn.accessToken;

    const clientId = this.config.get<string>('MICROSOFT_CLIENT_ID');
    const clientSecret = this.config.get<string>('MICROSOFT_CLIENT_SECRET');
    const redirectUri = this.config.get<string>('MICROSOFT_REDIRECT_URI');

    const body = new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri!,
      refresh_token: conn.refreshToken,
      grant_type: 'refresh_token',
      scope: 'Calendars.Read offline_access',
    });

    const res = await fetch(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );

    if (!res.ok) return conn.accessToken;

    const tokens = (await res.json()) as MicrosoftTokenResponse;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await this.prisma.calendarConnection.update({
      where: { userId_provider: { userId, provider: 'microsoft' } },
      data: { accessToken: tokens.access_token, expiresAt },
    });

    return tokens.access_token;
  }
}
