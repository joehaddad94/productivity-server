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
    if (!user || !pass) {
      this.logger.warn('SMTP not configured: SMTP_USER or SMTP_PASS is missing');
      return null;
    }

    const host = this.config.get<string>(MAIL_CONFIG.SMTP_HOST) ?? 'smtp.gmail.com';
    const port = Number(this.config.get<number>(MAIL_CONFIG.SMTP_PORT) ?? 587);
    const secure = port === 465;

    this.logger.log(`SMTP config: host=${host} port=${port} secure=${secure} user=${user}`);

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
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
      this.logger.error(`SMTP send failed to ${to}: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
      return false;
    }
  }

  async sendInviteEmail(
    to: string,
    workspaceName: string,
    inviteLink: string,
    recipientName: string,
  ): Promise<boolean> {
    const transport = this.getTransporter();
    if (!transport) return false;

    const from =
      this.config.get<string>(MAIL_CONFIG.SMTP_FROM) ?? MAIL_CONFIG.SMTP_FROM_DEFAULT;

    try {
      await transport.sendMail({
        from,
        to,
        subject: `You've been invited to ${workspaceName} on Tasky`,
        html: this.getInviteHtml(recipientName, workspaceName, inviteLink),
      });
      return true;
    } catch (err) {
      this.logger.error(`SMTP send failed to ${to}: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
      return false;
    }
  }

  private getInviteHtml(
    recipientName: string,
    workspaceName: string,
    inviteLink: string,
  ): string {
    return `
      <p>Hi ${recipientName},</p>
      <p>You've been invited to join the workspace <strong>${workspaceName}</strong> on Tasky.</p>
      <p><a href="${inviteLink}" style="display:inline-block;padding:10px 20px;background:#047857;color:#fff;text-decoration:none;border-radius:6px;">Accept Invitation</a></p>
      <p>If you didn't expect this invitation, you can safely ignore this email.</p>
    `.trim();
  }

  private getMagicLinkHtml(magicLink: string): string {
    return `
      <p>Click the link below to sign in. It expires in 15 minutes.</p>
      <p><a href="${magicLink}">Sign in</a></p>
      <p>If you didn't request this, you can ignore this email.</p>
    `.trim();
  }
}
