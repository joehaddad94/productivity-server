import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { MAIL_CONFIG } from './mail.config';

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

describe('MailService', () => {
  let service: MailService;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: { get: configGet },
        },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    mockSendMail.mockReset();
  });

  describe('sendMagicLinkEmail', () => {
    it('returns false when SMTP_USER is not set', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === MAIL_CONFIG.SMTP_USER) return undefined;
        if (key === MAIL_CONFIG.SMTP_PASS) return 'pass';
        return undefined;
      });

      const result = await service.sendMagicLinkEmail(
        'user@example.com',
        'http://localhost/verify?token=1',
      );

      expect(result).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('returns false when SMTP_PASS is not set', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === MAIL_CONFIG.SMTP_USER) return 'user';
        if (key === MAIL_CONFIG.SMTP_PASS) return undefined;
        return undefined;
      });

      const result = await service.sendMagicLinkEmail(
        'user@example.com',
        'http://localhost/verify?token=1',
      );

      expect(result).toBe(false);
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('returns true and sends mail when credentials are set and sendMail succeeds', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === MAIL_CONFIG.SMTP_USER) return 'smtp-user';
        if (key === MAIL_CONFIG.SMTP_PASS) return 'smtp-pass';
        if (key === MAIL_CONFIG.SMTP_FROM) return 'App <app@example.com>';
        return undefined;
      });
      mockSendMail.mockResolvedValue(undefined);

      const result = await service.sendMagicLinkEmail(
        'recipient@example.com',
        'https://app.example.com/auth/verify?token=abc',
      );

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'App <app@example.com>',
        to: 'recipient@example.com',
        subject: 'Your magic link to sign in',
        html: expect.stringContaining('https://app.example.com/auth/verify?token=abc'),
      });
      expect(mockSendMail.mock.calls[0][0].html).toContain('Sign in');
      expect(mockSendMail.mock.calls[0][0].html).toContain('15 minutes');
    });

    it('uses SMTP_FROM default when not set in config', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === MAIL_CONFIG.SMTP_USER) return 'u';
        if (key === MAIL_CONFIG.SMTP_PASS) return 'p';
        if (key === MAIL_CONFIG.SMTP_FROM) return undefined;
        return undefined;
      });
      mockSendMail.mockResolvedValue(undefined);

      await service.sendMagicLinkEmail('to@example.com', 'http://link');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: MAIL_CONFIG.SMTP_FROM_DEFAULT,
          to: 'to@example.com',
          subject: 'Your magic link to sign in',
        }),
      );
    });

    it('returns false when sendMail throws', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === MAIL_CONFIG.SMTP_USER) return 'u';
        if (key === MAIL_CONFIG.SMTP_PASS) return 'p';
        return undefined;
      });
      mockSendMail.mockRejectedValue(new Error('SMTP connection failed'));

      const result = await service.sendMagicLinkEmail(
        'user@example.com',
        'http://localhost/link',
      );

      expect(result).toBe(false);
    });

    it('returns false when sendMail throws a non-Error', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === MAIL_CONFIG.SMTP_USER) return 'u';
        if (key === MAIL_CONFIG.SMTP_PASS) return 'p';
        return undefined;
      });
      mockSendMail.mockRejectedValue('string error');

      const result = await service.sendMagicLinkEmail(
        'user@example.com',
        'http://localhost/link',
      );

      expect(result).toBe(false);
    });

    it('includes the magic link in the email html', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === MAIL_CONFIG.SMTP_USER) return 'u';
        if (key === MAIL_CONFIG.SMTP_PASS) return 'p';
        return undefined;
      });
      mockSendMail.mockResolvedValue(undefined);

      const link = 'https://custom.domain/auth/verify?token=xyz123';
      await service.sendMagicLinkEmail('test@example.com', link);

      const sentHtml = mockSendMail.mock.calls[0][0].html;
      expect(sentHtml).toContain(link);
      expect(sentHtml).toContain(`href="${link}"`);
    });

    it('reuses the same transporter on multiple calls', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === MAIL_CONFIG.SMTP_USER) return 'u';
        if (key === MAIL_CONFIG.SMTP_PASS) return 'p';
        return undefined;
      });
      mockSendMail.mockResolvedValue(undefined);

      await service.sendMagicLinkEmail('a@example.com', 'http://link1');
      await service.sendMagicLinkEmail('b@example.com', 'http://link2');

      expect(mockSendMail).toHaveBeenCalledTimes(2);
      expect(mockSendMail).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ to: 'a@example.com' }),
      );
      expect(mockSendMail).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ to: 'b@example.com' }),
      );
    });
  });
});
