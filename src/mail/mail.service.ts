import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoClient } from '@getbrevo/brevo';
import {
  RenderedEmail,
  addedToWorkspaceEmail,
  inviteEmail,
  magicLinkEmail,
  notificationEmail,
} from './mail.templates';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private client: BrevoClient | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): {
    emails: BrevoClient['transactionalEmails'];
    from: { name: string; email: string };
  } | null {
    const apiKey = this.config.get<string>('BREVO_API_KEY');
    if (!apiKey) {
      this.logger.warn('BREVO_API_KEY is not set — email sending is disabled');
      return null;
    }

    this.client ??= new BrevoClient({ apiKey });
    const fromName = this.config.get<string>('SMTP_FROM_NAME') ?? 'Tasky';
    const fromEmail =
      this.config.get<string>('SMTP_FROM_EMAIL') ?? 'noreply@tasky.app';

    return {
      emails: this.client.transactionalEmails,
      from: { name: fromName, email: fromEmail },
    };
  }

  private appUrl(): string {
    return this.config.get<string>('APP_URL') ?? 'http://localhost:3000';
  }

  private async send(
    to: string,
    email: RenderedEmail,
    kind: string,
  ): Promise<boolean> {
    const ctx = this.getClient();
    if (!ctx) return false;

    try {
      await ctx.emails.sendTransacEmail({
        sender: ctx.from,
        to: [{ email: to }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
      });
      this.logger.log(`${kind} email sent to ${to}`);
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to send ${kind} email to ${to}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return false;
    }
  }

  async sendMagicLinkEmail(to: string, magicLink: string): Promise<boolean> {
    return this.send(to, magicLinkEmail(magicLink), 'Magic link');
  }

  async sendNotificationEmail(
    to: string,
    title: string,
    body: string,
  ): Promise<boolean> {
    const preferencesUrl = `${this.appUrl()}/settings?tab=notifications`;
    return this.send(
      to,
      notificationEmail(title, body, preferencesUrl),
      'Notification',
    );
  }

  async sendInviteEmail(
    to: string,
    workspaceName: string,
    inviteLink: string,
    recipientName: string | null,
  ): Promise<boolean> {
    return this.send(
      to,
      inviteEmail(recipientName, workspaceName, inviteLink),
      'Invite',
    );
  }

  async sendAddedToWorkspaceEmail(
    to: string,
    workspaceName: string,
    workspaceUrl: string,
    recipientName: string | null,
  ): Promise<boolean> {
    return this.send(
      to,
      addedToWorkspaceEmail(recipientName, workspaceName, workspaceUrl),
      'Added-to-workspace',
    );
  }
}
