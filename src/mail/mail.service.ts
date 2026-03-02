import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { MAIL_CONFIG } from './mail.config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Transporter | null {
    if (this.transporter) return this.transporter;

    const user = this.config.get<string>(MAIL_CONFIG.SMTP_USER);
    const pass = this.config.get<string>(MAIL_CONFIG.SMTP_PASS);
    if (!user || !pass) return null;

    const host = this.config.get<string>(MAIL_CONFIG.SMTP_HOST) ?? 'smtp.gmail.com';
    const port = this.config.get<number>(MAIL_CONFIG.SMTP_PORT) ?? 587;

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: port === 465,
      auth: { user, pass },
    });

    return this.transporter;
  }

  async sendMagicLinkEmail(to: string, magicLink: string): Promise<boolean> {
    const transport = this.getTransporter();
    if (!transport) return false;

    const from =
      this.config.get<string>(MAIL_CONFIG.SMTP_FROM) ?? MAIL_CONFIG.SMTP_FROM_DEFAULT;

    try {
      await transport.sendMail({
        from,
        to,
        subject: 'Your magic link to sign in',
        html: this.getMagicLinkHtml(magicLink),
      });
      return true;
    } catch (err) {
      this.logger.warn(`SMTP send failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private getMagicLinkHtml(magicLink: string): string {
    return `
      <p>Click the link below to sign in. It expires in 15 minutes.</p>
      <p><a href="${magicLink}">Sign in</a></p>
      <p>If you didn't request this, you can ignore this email.</p>
    `.trim();
  }
}
