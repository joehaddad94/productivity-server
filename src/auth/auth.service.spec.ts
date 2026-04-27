import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { User } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { SessionService } from './services/session.service';
import { MagicLinkService } from './services/magic-link.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Pick<UsersService, 'findByEmail' | 'create'>>;
  let mailService: jest.Mocked<Pick<MailService, 'sendMagicLinkEmail'>>;
  let sessionService: jest.Mocked<
    Pick<SessionService, 'createSession' | 'signToken' | 'revokeSession'>
  >;
  let magicLinkService: jest.Mocked<
    Pick<MagicLinkService, 'createMagicLink' | 'consumeToken'>
  >;

  const mockUser: User = {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Jane',
    avatarUrl: null,
    timezone: null,
    isAdmin: false,
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockUsersService = {
      findByEmail: jest.fn(),
      create: jest.fn(),
    };
    const mockMailService = {
      sendMagicLinkEmail: jest.fn(),
    };
    const mockSessionService = {
      createSession: jest.fn(),
      signToken: jest.fn(),
      revokeSession: jest.fn(),
    };
    const mockMagicLinkService = {
      createMagicLink: jest.fn(),
      consumeToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: MailService, useValue: mockMailService },
        { provide: SessionService, useValue: mockSessionService },
        { provide: MagicLinkService, useValue: mockMagicLinkService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService) as typeof mockUsersService;
    mailService = module.get(MailService) as typeof mockMailService;
    sessionService = module.get(SessionService) as typeof mockSessionService;
    magicLinkService = module.get(MagicLinkService) as typeof mockMagicLinkService;

    jest.clearAllMocks();
  });

  describe('register', () => {
    it('throws ConflictException when email already exists', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        service.register({ email: 'user@example.com', name: 'Jane' }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.register({ email: 'user@example.com', name: 'Jane' }),
      ).rejects.toThrow('A user with this email already exists');

      expect(usersService.findByEmail).toHaveBeenCalledWith('user@example.com');
      expect(magicLinkService.createMagicLink).not.toHaveBeenCalled();
      expect(mailService.sendMagicLinkEmail).not.toHaveBeenCalled();
    });

    it('creates magic link and sends email when user does not exist', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      magicLinkService.createMagicLink.mockResolvedValue({
        magicLink: 'http://localhost/auth/verify?token=abc',
      });
      mailService.sendMagicLinkEmail.mockResolvedValue(true);

      const result = await service.register({
        email: 'new@example.com',
        name: 'New User',
      });

      expect(result.message).toContain('Check your email to complete signup');
      expect(result.magicLink).toBeUndefined();
      expect(magicLinkService.createMagicLink).toHaveBeenCalledWith(
        'new@example.com',
        'New User',
      );
      expect(mailService.sendMagicLinkEmail).toHaveBeenCalledWith(
        'new@example.com',
        'http://localhost/auth/verify?token=abc',
      );
    });

    it('normalizes email to lowercase and trim when creating link and sending mail', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      magicLinkService.createMagicLink.mockResolvedValue({
        magicLink: 'http://localhost/auth/verify?token=x',
      });
      mailService.sendMagicLinkEmail.mockResolvedValue(false);

      await service.register({
        email: '  UPPER@Example.COM  ',
        name: 'Test',
      });

      expect(mailService.sendMagicLinkEmail).toHaveBeenCalledWith(
        'upper@example.com',
        'http://localhost/auth/verify?token=x',
      );
    });

    it('returns magicLink in response when SMTP does not send (dev mode)', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      magicLinkService.createMagicLink.mockResolvedValue({
        magicLink: 'http://localhost/verify?token=dev',
      });
      mailService.sendMagicLinkEmail.mockResolvedValue(false);

      const result = await service.register({
        email: 'dev@example.com',
      });

      expect(result.magicLink).toBe('http://localhost/verify?token=dev');
      expect(result.message).toContain('Use the link below in dev');
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException when no account exists for email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@example.com' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.login({ email: 'unknown@example.com' }),
      ).rejects.toThrow('No account found for this email');

      expect(magicLinkService.createMagicLink).not.toHaveBeenCalled();
      expect(mailService.sendMagicLinkEmail).not.toHaveBeenCalled();
    });

    it('sends magic link when user exists and mail is sent', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);
      magicLinkService.createMagicLink.mockResolvedValue({
        magicLink: 'http://localhost/auth/verify?token=xyz',
      });
      mailService.sendMagicLinkEmail.mockResolvedValue(true);

      const result = await service.login({ email: 'user@example.com' });

      expect(result.message).toContain('Check your email to sign in');
      expect(result.magicLink).toBeUndefined();
      expect(mailService.sendMagicLinkEmail).toHaveBeenCalledWith(
        'user@example.com',
        'http://localhost/auth/verify?token=xyz',
      );
    });

    it('normalizes email when sending login magic link', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);
      magicLinkService.createMagicLink.mockResolvedValue({
        magicLink: 'http://localhost/auth/verify?token=q',
      });
      mailService.sendMagicLinkEmail.mockResolvedValue(false);

      await service.login({ email: '  User@Example.COM  ' });

      expect(mailService.sendMagicLinkEmail).toHaveBeenCalledWith(
        'user@example.com',
        'http://localhost/auth/verify?token=q',
      );
    });

    it('returns magicLink when mail is not sent (dev)', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);
      magicLinkService.createMagicLink.mockResolvedValue({
        magicLink: 'http://localhost/verify?token=login-dev',
      });
      mailService.sendMagicLinkEmail.mockResolvedValue(false);

      const result = await service.login({ email: 'user@example.com' });

      expect(result.magicLink).toBe('http://localhost/verify?token=login-dev');
    });
  });

  describe('logout', () => {
    it('calls sessionService.revokeSession with given session id', async () => {
      sessionService.revokeSession.mockResolvedValue(undefined);

      await service.logout('session-123');

      expect(sessionService.revokeSession).toHaveBeenCalledWith('session-123');
    });
  });

  describe('sendMagicLink', () => {
    it('returns message when mail is sent', async () => {
      magicLinkService.createMagicLink.mockResolvedValue({
        magicLink: 'http://localhost/verify?t=1',
      });
      mailService.sendMagicLinkEmail.mockResolvedValue(true);

      const result = await service.sendMagicLink('any@example.com');

      expect(result.message).toContain('you will receive a magic link shortly');
      expect(result.magicLink).toBeUndefined();
    });

    it('returns magicLink when mail is not sent', async () => {
      magicLinkService.createMagicLink.mockResolvedValue({
        magicLink: 'http://localhost/verify?t=2',
      });
      mailService.sendMagicLinkEmail.mockResolvedValue(false);

      const result = await service.sendMagicLink('any@example.com');

      expect(result.magicLink).toBe('http://localhost/verify?t=2');
    });

    it('normalizes email before createMagicLink and sendMail', async () => {
      magicLinkService.createMagicLink.mockResolvedValue({
        magicLink: 'http://localhost/link',
      });
      mailService.sendMagicLinkEmail.mockResolvedValue(false);

      await service.sendMagicLink('  FOO@BAR.COM  ');

      expect(magicLinkService.createMagicLink).toHaveBeenCalledWith(
        'foo@bar.com',
      );
      expect(mailService.sendMagicLinkEmail).toHaveBeenCalledWith(
        'foo@bar.com',
        'http://localhost/link',
      );
    });
  });

  describe('verifyMagicLink', () => {
    it('creates user when email from token does not exist', async () => {
      const newUser = {
        ...mockUser,
        id: 'user-new',
        email: 'new@example.com',
        name: 'New Name',
      };
      magicLinkService.consumeToken.mockResolvedValue({
        email: 'new@example.com',
        name: 'New Name',
      });
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(newUser);
      sessionService.createSession.mockResolvedValue({
        id: 'sess-1',
        expiresAt: new Date(),
      });
      sessionService.signToken.mockReturnValue('jwt-token');

      const result = await service.verifyMagicLink('valid-token');

      expect(usersService.findByEmail).toHaveBeenCalledWith('new@example.com');
      expect(usersService.create).toHaveBeenCalledWith({
        email: 'new@example.com',
        name: 'New Name',
      });
      expect(sessionService.createSession).toHaveBeenCalledWith('user-new');
      expect(result.user).toEqual({
        id: 'user-new',
        email: 'new@example.com',
        name: 'New Name',
      });
      expect(result.accessToken).toBe('jwt-token');
    });

    it('uses existing user when email from token exists', async () => {
      magicLinkService.consumeToken.mockResolvedValue({
        email: 'user@example.com',
        name: 'Jane',
      });
      usersService.findByEmail.mockResolvedValue(mockUser);
      sessionService.createSession.mockResolvedValue({
        id: 'sess-2',
        expiresAt: new Date(),
      });
      sessionService.signToken.mockReturnValue('jwt-existing');

      const result = await service.verifyMagicLink('valid-token');

      expect(usersService.findByEmail).toHaveBeenCalledWith('user@example.com');
      expect(usersService.create).not.toHaveBeenCalled();
      expect(sessionService.createSession).toHaveBeenCalledWith('user-1');
      expect(result.user).toEqual({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Jane',
      });
      expect(result.accessToken).toBe('jwt-existing');
    });

    it('propagates BadRequestException when token is invalid or expired', async () => {
      magicLinkService.consumeToken.mockRejectedValue(
        new BadRequestException('Invalid or expired link'),
      );

      await expect(service.verifyMagicLink('bad-token')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.verifyMagicLink('bad-token')).rejects.toThrow(
        'Invalid or expired link',
      );

      expect(usersService.findByEmail).not.toHaveBeenCalled();
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('passes name from consumeToken when creating new user', async () => {
      magicLinkService.consumeToken.mockResolvedValue({
        email: 'nobody@example.com',
        name: null,
      });
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({
        ...mockUser,
        id: 'id',
        email: 'nobody@example.com',
        name: null,
      });
      sessionService.createSession.mockResolvedValue({
        id: 's',
        expiresAt: new Date(),
      });
      sessionService.signToken.mockReturnValue('t');

      await service.verifyMagicLink('token');

      expect(usersService.create).toHaveBeenCalledWith({
        email: 'nobody@example.com',
        name: null,
      });
    });
  });
});
