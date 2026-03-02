import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { MAIL_CONFIG } from './mail.config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendMagicLinkEmail(to: string, magicLink: string): Promise<boolean> {
    const apiKey = this.config.get<string>(MAIL_CONFIG.RESEND_API_KEY);
    if (!apiKey) {
      return false;
    }

    const resend = new Resend(apiKey);
    const from = this.config.get(MAIL_CONFIG.RESEND_FROM) ?? MAIL_CONFIG.RESEND_FROM_DEFAULT;

    const { error } = await resend.emails.send({
      from,
      to,
      subject: 'Your magic link to sign in',
      html: this.getMagicLinkHtml(magicLink),
    });

    if (error) {
      this.logger.warn(`Resend failed: ${JSON.stringify(error)}`);
      return false;
    }

    return true;
  }

  private getMagicLinkHtml(magicLink: string): string {
    return `
      <p>Click the link below to sign in. It expires in 15 minutes.</p>
      <p><a href="${magicLink}">Sign in</a></p>
      <p>If you didn't request this, you can ignore this email.</p>
    `.trim();
  }
}
