import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_CONFIG } from '../config/auth-config';
import { RequestUser } from '../decorators/current-user.decorator';
import { UsersService } from '../../users/users.service';

interface JwtPayload {
  sub: string;
  email: string;
  jti: string;
}

function jwtFromCookieOrHeader(cookieName: string) {
  return (req: Request): string | null => {
    const fromCookie = req?.cookies?.[cookieName];
    if (fromCookie) return fromCookie;
    return ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  };
}

// Cache validated sessions for 30s to avoid 2 DB round-trips on every request.
// TTL is short enough that revoked sessions (logout) take effect within 30s.
// On logout, sessionCache.delete(jti) is called immediately so revocation is instant.
class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();
  constructor(private readonly ttlMs: number, private readonly max: number) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return undefined; }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.max) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void { this.store.delete(key); }
}

export const sessionCache = new TtlCache<RequestUser>(30_000, 1000);

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: jwtFromCookieOrHeader(AUTH_CONFIG.COOKIE_NAME),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>(AUTH_CONFIG.JWT_SECRET),
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    const cached = sessionCache.get(payload.jti);
    if (cached) return cached;

    const session = await this.prisma.session.findUnique({
      where: { id: payload.jti },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session invalid or expired');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Session invalid. Please sign in again.');
    }

    const requestUser: RequestUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      sessionId: payload.jti,
      isAdmin: user.isAdmin,
      timezone: user.timezone ?? null,
    };

    sessionCache.set(payload.jti, requestUser);
    return requestUser;
  }
}
