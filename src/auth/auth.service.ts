import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { SessionService } from './services/session.service';
import { MagicLinkService } from './services/magic-link.service';
import type { AuthResult, MagicLinkMessageResult } from './types/auth.types';
import { sessionCache } from './strategies/jwt.strategy';
import { MagicLinkRateLimiter } from './utils/magic-link-rate-limiter';

@Injectable()
export class AuthService {
  private readonly rateLimiter = new MagicLinkRateLimiter();

  constructor(
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly sessionService: SessionService,
    private readonly magicLinkService: MagicLinkService,
  ) {}

  async register(dto: RegisterDto): Promise<MagicLinkMessageResult> {
    const normalized = dto.email.toLowerCase().trim();
    this.rateLimiter.check(normalized);
    const existing = await this.usersService.findByEmail(normalized);
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const { magicLink } = await this.magicLinkService.createMagicLink(
      normalized,
      dto.name,
    );
    const sent = await this.mailService.sendMagicLinkEmail(
      normalized,
      magicLink,
    );
    if (!sent) {
      throw new ServiceUnavailableException(
        'Failed to send verification email. Please try again.',
      );
    }

    return {
      message:
        'Check your email to complete signup. Click the link to access your account.',
    };
  }

  async login(dto: LoginDto): Promise<MagicLinkMessageResult> {
    const normalized = dto.email.toLowerCase().trim();
    this.rateLimiter.check(normalized);
    const user = await this.usersService.findByEmail(normalized);
    if (!user) {
      throw new UnauthorizedException(
        'No account found for this email. Please sign up first.',
      );
    }

    const { magicLink } =
      await this.magicLinkService.createMagicLink(normalized);
    const sent = await this.mailService.sendMagicLinkEmail(
      normalized,
      magicLink,
    );
    if (!sent) {
      return { message: 'Use the link below in dev.', magicLink };
    }

    return {
      message:
        'Check your email to sign in. Click the link to access your account.',
    };
  }

  async logout(sessionId: string): Promise<void> {
    sessionCache.delete(sessionId);
    await this.sessionService.revokeSession(sessionId);
  }

  async sendMagicLink(
    email: string,
  ): Promise<{ magicLink?: string; message?: string }> {
    const normalized = email.toLowerCase().trim();
    this.rateLimiter.check(normalized);
    const { magicLink } =
      await this.magicLinkService.createMagicLink(normalized);
    const sent = await this.mailService.sendMagicLinkEmail(
      normalized,
      magicLink,
    );
    if (sent) {
      return {
        message:
          'If that email is registered, you will receive a magic link shortly.',
      };
    }
    return { magicLink };
  }

  async createDevSession(email: string, name?: string): Promise<AuthResult> {
    const normalized = email.toLowerCase().trim();
    let user = await this.usersService.findByEmail(normalized);
    if (!user) {
      user = await this.usersService.create({
        email: normalized,
        name: name ?? null,
      });
    }
    const session = await this.sessionService.createSession(user.id);
    const accessToken = this.sessionService.signToken({
      sub: user.id,
      email: user.email,
      jti: session.id,
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
      },
      accessToken,
    };
  }

  async verifyMagicLink(token: string): Promise<AuthResult> {
    const { email, name } = await this.magicLinkService.consumeToken(token);

    let user = await this.usersService.findByEmail(email);
    if (!user) {
      user = await this.usersService.create({ email, name });
    }

    const session = await this.sessionService.createSession(user.id);
    const accessToken = this.sessionService.signToken({
      sub: user.id,
      email: user.email,
      jti: session.id,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
      },
      accessToken,
    };
  }
}
