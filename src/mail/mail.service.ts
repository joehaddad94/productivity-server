import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoClient } from '@getbrevo/brevo';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  private getClient(): { emails: BrevoClient['transactionalEmails']; from: { name: string; email: string } } | null {
    const apiKey = this.config.get<string>('BREVO_API_KEY');
    if (!apiKey) {
      this.logger.warn('BREVO_API_KEY is not set — email sending is disabled');
      return null;
    }

    const client = new BrevoClient({ apiKey });
    const fromName = this.config.get<string>('SMTP_FROM_NAME') ?? 'Tasky';
    const fromEmail = this.config.get<string>('SMTP_FROM_EMAIL') ?? 'noreply@tasky.app';

    return { emails: client.transactionalEmails, from: { name: fromName, email: fromEmail } };
  }

  async sendMagicLinkEmail(to: string, magicLink: string): Promise<boolean> {
    const ctx = this.getClient();
    if (!ctx) return false;

    try {
      await ctx.emails.sendTransacEmail({
        sender: ctx.from,
        to: [{ email: to }],
        subject: 'Your magic link to sign in',
        htmlContent: this.getMagicLinkHtml(magicLink),
      });
      this.logger.log(`Magic link email sent to ${to}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to send magic link to ${to}: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
      return false;
    }
  }

  async sendInviteEmail(to: string, workspaceName: string, inviteLink: string, recipientName: string): Promise<boolean> {
    const ctx = this.getClient();
    if (!ctx) return false;

    try {
      await ctx.emails.sendTransacEmail({
        sender: ctx.from,
        to: [{ email: to }],
        subject: `You've been invited to ${workspaceName} on Tasky`,
        htmlContent: this.getInviteHtml(recipientName, workspaceName, inviteLink),
      });
      this.logger.log(`Invite email sent to ${to}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to send invite to ${to}: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? err.stack : undefined);
      return false;
    }
  }

  private getInviteHtml(recipientName: string, workspaceName: string, inviteLink: string): string {
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
