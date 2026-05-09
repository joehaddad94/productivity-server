import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

const mockSendTransacEmail = jest.fn();
jest.mock('@getbrevo/brevo', () => ({
  BrevoClient: jest.fn(() => ({
    transactionalEmails: {
      sendTransacEmail: mockSendTransacEmail,
    },
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
    mockSendTransacEmail.mockReset();
  });

  describe('sendMagicLinkEmail', () => {
    it('returns false when BREVO_API_KEY is not set', async () => {
      configGet.mockReturnValue(undefined);

      const result = await service.sendMagicLinkEmail(
        'user@example.com',
        'http://localhost/verify?token=1',
      );

      expect(result).toBe(false);
      expect(mockSendTransacEmail).not.toHaveBeenCalled();
    });

    it('returns true and sends email when BREVO_API_KEY is set', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'BREVO_API_KEY') return 'brevo-key';
        if (key === 'SMTP_FROM_NAME') return 'Tasky';
        if (key === 'SMTP_FROM_EMAIL') return 'no-reply@tasky.app';
        return undefined;
      });
      mockSendTransacEmail.mockResolvedValue(undefined);

      const result = await service.sendMagicLinkEmail(
        'recipient@example.com',
        'https://app.example.com/auth/verify?token=abc',
      );

      expect(result).toBe(true);
      expect(mockSendTransacEmail).toHaveBeenCalledTimes(1);
      expect(mockSendTransacEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: [{ email: 'recipient@example.com' }],
          subject: 'Your magic link to sign in',
          htmlContent: expect.stringContaining(
            'https://app.example.com/auth/verify?token=abc',
          ),
        }),
      );
    });

    it('returns false when sendTransacEmail throws', async () => {
      configGet.mockImplementation((key: string) =>
        key === 'BREVO_API_KEY' ? 'brevo-key' : undefined,
      );
      mockSendTransacEmail.mockRejectedValue(new Error('Brevo API error'));

      const result = await service.sendMagicLinkEmail(
        'user@example.com',
        'http://localhost/link',
      );

      expect(result).toBe(false);
    });

    it('returns false when sendTransacEmail throws a non-Error', async () => {
      configGet.mockImplementation((key: string) =>
        key === 'BREVO_API_KEY' ? 'brevo-key' : undefined,
      );
      mockSendTransacEmail.mockRejectedValue('string error');

      const result = await service.sendMagicLinkEmail(
        'user@example.com',
        'http://localhost/link',
      );

      expect(result).toBe(false);
    });

    it('includes the magic link in the email html', async () => {
      configGet.mockImplementation((key: string) =>
        key === 'BREVO_API_KEY' ? 'brevo-key' : undefined,
      );
      mockSendTransacEmail.mockResolvedValue(undefined);

      const link = 'https://custom.domain/auth/verify?token=xyz123';
      await service.sendMagicLinkEmail('test@example.com', link);

      const call = mockSendTransacEmail.mock.calls[0][0] as {
        htmlContent: string;
      };
      expect(call.htmlContent).toContain(link);
      expect(call.htmlContent).toContain(`href="${link}"`);
    });

    it('sends to multiple recipients on successive calls', async () => {
      configGet.mockImplementation((key: string) =>
        key === 'BREVO_API_KEY' ? 'brevo-key' : undefined,
      );
      mockSendTransacEmail.mockResolvedValue(undefined);

      await service.sendMagicLinkEmail('a@example.com', 'http://link1');
      await service.sendMagicLinkEmail('b@example.com', 'http://link2');

      expect(mockSendTransacEmail).toHaveBeenCalledTimes(2);
      expect(mockSendTransacEmail).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ to: [{ email: 'a@example.com' }] }),
      );
      expect(mockSendTransacEmail).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ to: [{ email: 'b@example.com' }] }),
      );
    });
  });
});
