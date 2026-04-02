import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { SessionService } from './services/session.service';
import { MagicLinkService } from './services/magic-link.service';
import type { AuthResult, MagicLinkMessageResult } from './types/auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly sessionService: SessionService,
    private readonly magicLinkService: MagicLinkService,
  ) {}

  async register(dto: RegisterDto): Promise<MagicLinkMessageResult> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const { magicLink } = await this.magicLinkService.createMagicLink(dto.email, dto.name);
    const sent = await this.mailService.sendMagicLinkEmail(dto.email.toLowerCase().trim(), magicLink);

    if (sent) {
      return { message: 'Check your email to complete signup. Click the link to access your account.' };
    }
    return { message: 'Check your email to complete signup. Use the link below in dev.', magicLink };
  }

  async login(dto: LoginDto): Promise<MagicLinkMessageResult> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('No account found for this email');
    }

    const { magicLink } = await this.magicLinkService.createMagicLink(dto.email);
    const sent = await this.mailService.sendMagicLinkEmail(dto.email.toLowerCase().trim(), magicLink);

    if (sent) {
      return { message: 'Check your email to sign in. Click the link to access your account.' };
    }
    return { message: 'Check your email to sign in. Use the link below in dev.', magicLink };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessionService.revokeSession(sessionId);
  }

  async sendMagicLink(email: string): Promise<{ magicLink?: string; message?: string }> {
    const normalized = email.toLowerCase().trim();
    const { magicLink } = await this.magicLinkService.createMagicLink(normalized);
    const sent = await this.mailService.sendMagicLinkEmail(normalized, magicLink);
    if (sent) {
      return { message: 'If that email is registered, you will receive a magic link shortly.' };
    }
    return { magicLink };
  }

  /** Dev/test only: create or reuse a user and return a session directly. */
  async devSession(email: string, name: string): Promise<AuthResult> {
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
    return { user: { id: user.id, email: user.email, name: user.name }, accessToken };
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
      user: { id: user.id, email: user.email, name: user.name },
      accessToken,
    };
  }
}
