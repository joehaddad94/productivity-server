import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_CONFIG } from '../config/auth-config';
import { randomBytes } from 'node:crypto';

/** Parse "14d" -> ms */
function parseExpiresInToMs(expiresIn: string): number {
  const match = /^(\d+)(d|h|m|s)$/.exec(expiresIn?.trim() || '');
  if (!match) return 14 * 24 * 60 * 60 * 1000; // default 14 days
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    d: 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    m: 60 * 1000,
    s: 1000,
  };
  return n * (multipliers[unit] ?? 0);
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  signToken(payload: { sub: string; email: string; jti: string }): string {
    return this.jwtService.sign(payload);
  }

  async createSession(
    userId: string,
  ): Promise<{ id: string; expiresAt: Date }> {
    const expiresIn =
      this.config.get<string>(AUTH_CONFIG.JWT_EXPIRES_IN) ??
      AUTH_CONFIG.JWT_EXPIRES_IN_DEFAULT;
    const expiresAt = new Date(Date.now() + parseExpiresInToMs(expiresIn));
    const token = randomBytes(32).toString('hex');
    const session = await this.prisma.session.create({
      data: { userId, token, expiresAt },
    });
    return { id: session.id, expiresAt };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }
}
