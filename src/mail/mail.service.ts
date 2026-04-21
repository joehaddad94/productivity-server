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

  async sendNotificationEmail(to: string, title: string, body: string): Promise<boolean> {
    const ctx = this.getClient();
    if (!ctx) return false;

    try {
      await ctx.emails.sendTransacEmail({
        sender: ctx.from,
        to: [{ email: to }],
        subject: title,
        htmlContent: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
            <h2 style="color:#047857;margin-bottom:8px">${title}</h2>
            <p style="color:#374151;font-size:15px">${body}</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
            <p style="color:#9ca3af;font-size:12px">You're receiving this because you have email notifications enabled in Tasky. <a href="${this.config.get('FRONTEND_URL') ?? 'http://localhost:3000'}/settings?tab=notifications" style="color:#047857">Manage preferences</a></p>
          </div>
        `.trim(),
      });
      this.logger.log(`Notification email sent to ${to}: ${title}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to send notification email to ${to}: ${err instanceof Error ? err.message : String(err)}`);
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
      <div style="margin:0;background:#f4f4f5;padding:28px 14px;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#0a0a0a;">
        <div style="max-width:560px;margin:0 auto;">
          <div style="margin:0 auto 12px;width:max-content;padding:6px 10px;border-radius:999px;background:#0478571a;color:#047857;font-size:12px;font-weight:600;letter-spacing:.02em;">
            Tasky
          </div>

          <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;box-shadow:0 8px 24px rgba(10,10,10,.06);padding:28px;">
            <h2 style="margin:0 0 10px;font-size:22px;line-height:1.25;color:#0a0a0a;">Sign in to Tasky</h2>
            <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#71717a;">
              Use the secure link below to access your account. This sign-in link expires in <strong>15 minutes</strong>.
            </p>

            <p style="margin:0 0 20px;">
              <a
                href="${magicLink}"
                style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:10px;font-size:14px;font-weight:600;"
              >
                Sign in to Tasky
              </a>
            </p>

            <p style="margin:0 0 8px;line-height:1.5;">
              Or copy and paste this link in your browser:
            </p>

            <p style="margin:0 0 18px;font-size:12px;line-height:1.6;color:#71717a;word-break:break-all;">
              <a href="${magicLink}" style="color:#047857;text-decoration:underline;">${magicLink}</a>
            </p>

            <p style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">
              You received this because someone requested a sign-in link for your email. If this was not you, you can safely ignore this message.
            </p>
          </div>

          <p style="margin:12px 0 0;text-align:center;font-size:12px;color:#71717a;">
            Tasky • Track tasks • Focus better • Stay consistent
          </p>
        </div>
      </div>
    `.trim();
  }
}
