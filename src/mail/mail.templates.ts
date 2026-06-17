/**
 * Pure template builders for all transactional emails.
 *
 * No Nest dependencies — this module is also imported by
 * `scripts/preview-emails.ts` to render browser previews.
 *
 * Every interpolated value must go through `escapeHtml` unless it is a
 * server-built URL. Keep the CSS Outlook-safe: no alpha hex colors,
 * no `max-content` widths, tables for anything that must keep its shape.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BRAND = {
  name: 'Tasky',
  green: '#047857',
  greenSoft: '#e6f2ee',
  ink: '#0a0a0a',
  muted: '#71717a',
  border: '#e4e4e7',
  bg: '#f4f4f5',
  tagline: 'Track tasks • Focus better • Stay consistent',
};

function button(href: string, label: string): string {
  return `
    <p style="margin:0 0 20px;">
      <a
        href="${escapeHtml(href)}"
        style="display:inline-block;background:${BRAND.green};color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:10px;font-size:14px;font-weight:600;"
      >
        ${escapeHtml(label)}
      </a>
    </p>
  `;
}

interface LayoutContent {
  /** Inbox preview line; rendered invisibly at the top of the body. */
  preheader: string;
  /** Card contents. Must already be escaped/safe HTML. */
  bodyHtml: string;
  /** Optional extra line under the card, e.g. a preferences link. Safe HTML. */
  footerHtml?: string;
}

function renderLayout({
  preheader,
  bodyHtml,
  footerHtml,
}: LayoutContent): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background:${BRAND.bg};">
    <span style="display:none;font-size:1px;color:${BRAND.bg};max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</span>
    <div style="margin:0;background:${BRAND.bg};padding:28px 14px;font-family:Inter,'Segoe UI',Arial,sans-serif;color:${BRAND.ink};">
      <div style="max-width:560px;margin:0 auto;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 12px;">
          <tr>
            <td style="padding:6px 10px;border-radius:999px;background:${BRAND.greenSoft};color:${BRAND.green};font-size:12px;font-weight:600;letter-spacing:.02em;">
              ${BRAND.name}
            </td>
          </tr>
        </table>

        <div style="background:#ffffff;border:1px solid ${BRAND.border};border-radius:16px;box-shadow:0 8px 24px rgba(10,10,10,.06);padding:28px;">
${bodyHtml}
        </div>
${footerHtml ? `\n        <p style="margin:12px 0 0;text-align:center;font-size:12px;color:${BRAND.muted};">${footerHtml}</p>` : ''}
        <p style="margin:12px 0 0;text-align:center;font-size:12px;color:${BRAND.muted};">
          ${BRAND.name} • ${BRAND.tagline}
        </p>
      </div>
    </div>
  </body>
</html>`;
}

export function magicLinkEmail(magicLink: string): RenderedEmail {
  const safeLink = escapeHtml(magicLink);
  const html = renderLayout({
    preheader: 'Your secure sign-in link expires in 15 minutes.',
    bodyHtml: `
          <h2 style="margin:0 0 10px;font-size:22px;line-height:1.25;color:${BRAND.ink};">Sign in to Tasky</h2>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:${BRAND.muted};">
            Use the secure link below to access your account. This sign-in link expires in <strong>15 minutes</strong>.
          </p>
${button(magicLink, 'Sign in to Tasky')}
          <p style="margin:0 0 8px;font-size:14px;line-height:1.5;">
            Or copy and paste this link in your browser:
          </p>
          <p style="margin:0 0 18px;font-size:12px;line-height:1.6;color:${BRAND.muted};word-break:break-all;">
            <a href="${safeLink}" style="color:${BRAND.green};text-decoration:underline;">${safeLink}</a>
          </p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">
            You received this because someone requested a sign-in link for your email. If this was not you, you can safely ignore this message.
          </p>`,
  });

  return {
    subject: 'Your magic link to sign in',
    html,
    text: [
      'Sign in to Tasky',
      '',
      'Use the link below to access your account. It expires in 15 minutes.',
      '',
      magicLink,
      '',
      'If you did not request this, you can safely ignore this message.',
    ].join('\n'),
  };
}

export function notificationEmail(
  title: string,
  body: string,
  preferencesUrl: string,
): RenderedEmail {
  const html = renderLayout({
    preheader: body,
    bodyHtml: `
          <h2 style="margin:0 0 10px;font-size:22px;line-height:1.25;color:${BRAND.ink};">${escapeHtml(title)}</h2>
          <p style="margin:0;font-size:15px;line-height:1.65;color:#374151;">${escapeHtml(body)}</p>`,
    footerHtml: `You're receiving this because you have email notifications enabled in Tasky. <a href="${escapeHtml(preferencesUrl)}" style="color:${BRAND.green};">Manage preferences</a>`,
  });

  return {
    subject: title,
    html,
    text: [title, '', body, '', `Manage preferences: ${preferencesUrl}`].join(
      '\n',
    ),
  };
}

function greeting(recipientName: string | null): string {
  return recipientName ? `Hi ${recipientName},` : 'Hi there,';
}

export function inviteEmail(
  recipientName: string | null,
  workspaceName: string,
  inviteLink: string,
): RenderedEmail {
  const html = renderLayout({
    preheader: `Join the ${workspaceName} workspace on Tasky.`,
    bodyHtml: `
          <h2 style="margin:0 0 10px;font-size:22px;line-height:1.25;color:${BRAND.ink};">${escapeHtml(greeting(recipientName))}</h2>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#374151;">
            You've been invited to join the workspace <strong>${escapeHtml(workspaceName)}</strong> on Tasky.
          </p>
${button(inviteLink, 'Accept invitation')}
          <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">
            If you didn't expect this invitation, you can safely ignore this email.
          </p>`,
  });

  return {
    subject: `You've been invited to ${workspaceName} on Tasky`,
    html,
    text: [
      greeting(recipientName),
      '',
      `You've been invited to join the workspace "${workspaceName}" on Tasky.`,
      '',
      `Accept the invitation: ${inviteLink}`,
      '',
      "If you didn't expect this invitation, you can safely ignore this email.",
    ].join('\n'),
  };
}

export function addedToWorkspaceEmail(
  recipientName: string | null,
  workspaceName: string,
  workspaceUrl: string,
): RenderedEmail {
  const html = renderLayout({
    preheader: `You now have access to ${workspaceName} on Tasky.`,
    bodyHtml: `
          <h2 style="margin:0 0 10px;font-size:22px;line-height:1.25;color:${BRAND.ink};">${escapeHtml(greeting(recipientName))}</h2>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#374151;">
            You've been added to the workspace <strong>${escapeHtml(workspaceName)}</strong> on Tasky. It's already available in your account.
          </p>
${button(workspaceUrl, 'Open workspace')}
          <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">
            If you think this was a mistake, you can leave the workspace from its settings page.
          </p>`,
  });

  return {
    subject: `You've been added to ${workspaceName} on Tasky`,
    html,
    text: [
      greeting(recipientName),
      '',
      `You've been added to the workspace "${workspaceName}" on Tasky.`,
      '',
      `Open it here: ${workspaceUrl}`,
    ].join('\n'),
  };
}
