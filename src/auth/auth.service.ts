import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';

/** Internal: service returns this; controller sets cookie and returns only user. */
export interface AuthResult {
  user: { id: string; email: string; name: string | null };
  accessToken: string;
}
import { AUTH_CONFIG } from './config/auth-config';
import { randomBytes } from 'node:crypto';

const MAGIC_LINK_EXPIRES_MS = 15 * 60 * 1000; // 15 minutes

/** Result of register: no session until user clicks magic link. */
export interface RegisterResult {
  message: string;
  magicLink?: string;
}

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
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
  ) {}

  /** Sign a JWT with session id (jti) for revocation. */
  private signToken(payload: { sub: string; email: string; jti: string }): string {
    return this.jwtService.sign(payload);
  }

  private async createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
    const expiresIn = this.config.get(AUTH_CONFIG.JWT_EXPIRES_IN) ?? AUTH_CONFIG.JWT_EXPIRES_IN_DEFAULT;
    const expiresAt = new Date(Date.now() + parseExpiresInToMs(expiresIn));
    const token = randomBytes(32).toString('hex');
    const session = await this.prisma.session.create({
      data: { userId, token, expiresAt },
    });
    return { id: session.id, expiresAt };
  }

  private async createMagicLinkForEmail(email: string): Promise<{ magicLink: string }> {
    const normalized = email.toLowerCase().trim();
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRES_MS);
    await this.prisma.verificationToken.create({
      data: { email: normalized, token, expiresAt },
    });
    const baseUrl = this.config.get('APP_URL') ?? 'http://localhost:3000';
    const magicLink = `${baseUrl}/auth/verify?token=${token}`;
    return { magicLink };
  }

  async register(dto: RegisterDto): Promise<RegisterResult> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    await this.usersService.create({
      email: dto.email,
      name: dto.name,
    });

    const { magicLink } = await this.createMagicLinkForEmail(dto.email);
    const sent = await this.mailService.sendMagicLinkEmail(dto.email.toLowerCase().trim(), magicLink);

    if (sent) {
      return { message: 'Check your email to complete signup. Click the link to access your account.' };
    }
    return { message: 'Account created. Use the link below to sign in (dev only).', magicLink };
  }

  /** Email-only login: if user exists, create session and return JWT. */
  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('No account found for this email');
    }

    const session = await this.createSession(user.id);
    const accessToken = this.signToken({
      sub: user.id,
      email: user.email,
      jti: session.id,
    });

    return {
      user: { id: user.id, email: user.email, name: user.name },
      accessToken,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async sendMagicLink(email: string): Promise<{ magicLink?: string; message?: string }> {
    const normalized = email.toLowerCase().trim();
    const { magicLink } = await this.createMagicLinkForEmail(normalized);

    const sent = await this.mailService.sendMagicLinkEmail(normalized, magicLink);
    if (sent) {
      return { message: 'If that email is registered, you will receive a magic link shortly.' };
    }
    return { magicLink };
  }

  async verifyMagicLink(token: string): Promise<AuthResult> {
    const record = await this.prisma.verificationToken.findUnique({
      where: { token },
    });
    if (!record) {
      throw new BadRequestException('Invalid or expired link');
    }
    if (record.expiresAt < new Date()) {
      await this.prisma.verificationToken.delete({ where: { id: record.id } }).catch(() => {});
      throw new BadRequestException('Link has expired');
    }

    let user = await this.usersService.findByEmail(record.email);
    if (!user) {
      user = await this.usersService.create({
        email: record.email,
        name: null,
      });
    }
    await this.prisma.verificationToken.delete({ where: { id: record.id } });

    const session = await this.createSession(user.id);
    const accessToken = this.signToken({
      sub: user.id,
      email: user.email,
      jti: session.id,
    });

    return {
      user: { id: user.id, email: user.email, name: user.name },
      accessToken,
    };
  }
}
