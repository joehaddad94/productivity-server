/**
 * Renders every email template with sample data into email-previews.html.
 *
 * Run:   npm run emails:preview
 * Then open email-previews.html in a browser. Desktop/mobile widths and the
 * plain-text part are shown for each template.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  RenderedEmail,
  addedToWorkspaceEmail,
  inviteEmail,
  magicLinkEmail,
  notificationEmail,
} from '../src/mail/mail.templates';

const APP = 'https://app.tasky.example';

const previews: { name: string; note?: string; email: RenderedEmail }[] = [
  {
    name: 'Magic link',
    email: magicLinkEmail(`${APP}/auth/verify?token=sample-token-abc123`),
  },
  {
    name: 'Notification — reminder',
    email: notificationEmail(
      'Reminder',
      '"Prepare Q3 report" is due today',
      `${APP}/settings?tab=notifications`,
    ),
  },
  {
    name: 'Notification — daily agenda',
    email: notificationEmail(
      'Daily Agenda',
      '3 tasks due today · 1 overdue · 2 in progress',
      `${APP}/settings?tab=notifications`,
    ),
  },
  {
    name: 'Invite (new user)',
    email: inviteEmail(
      null,
      'Marketing Team',
      `${APP}/signup?email=new%40example.com&workspace=ws_123`,
    ),
  },
  {
    name: 'Invite (named recipient)',
    email: inviteEmail('Joe', 'Marketing Team', `${APP}/signup`),
  },
  {
    name: 'Added to workspace (existing user)',
    email: addedToWorkspaceEmail('Joe', 'Marketing Team', `${APP}/dashboard`),
  },
  {
    name: 'Escaping check (hostile input)',
    note: 'Workspace name contains raw HTML — it must render as literal text, not as a link or image.',
    email: inviteEmail(
      '<b>Joe</b>',
      '<a href="https://evil.example">Click to claim your prize</a><img src=x onerror=alert(1)>',
      `${APP}/signup`,
    ),
  },
];

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function text(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Tasky email previews</title>
<style>
  body { margin: 0; font-family: Inter, 'Segoe UI', Arial, sans-serif; background: #fafafa; color: #0a0a0a; }
  nav { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e4e4e7; padding: 10px 16px; display: flex; gap: 8px; flex-wrap: wrap; z-index: 1; }
  nav button { border: 1px solid #e4e4e7; background: #fff; border-radius: 999px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
  nav button.active { background: #047857; color: #fff; border-color: #047857; }
  section { display: none; padding: 24px 16px; max-width: 1200px; margin: 0 auto; }
  section.active { display: block; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .subject { color: #374151; font-size: 14px; margin: 0 0 4px; }
  .note { color: #b45309; font-size: 13px; margin: 0 0 12px; }
  .frames { display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; margin-top: 12px; }
  .frame { border: 1px solid #e4e4e7; border-radius: 8px; background: #fff; overflow: hidden; }
  .frame header { font-size: 12px; color: #71717a; padding: 6px 10px; border-bottom: 1px solid #e4e4e7; }
  iframe { border: 0; display: block; height: 640px; }
  .desktop iframe { width: 700px; }
  .mobile iframe { width: 375px; }
  pre { background: #18181b; color: #e4e4e7; font-size: 12px; padding: 14px; border-radius: 8px; overflow: auto; max-width: 700px; }
</style>
</head>
<body>
<nav>
${previews
  .map(
    (p, i) =>
      `  <button data-target="p${i}"${i === 0 ? ' class="active"' : ''}>${text(p.name)}</button>`,
  )
  .join('\n')}
</nav>
${previews
  .map(
    (p, i) => `<section id="p${i}"${i === 0 ? ' class="active"' : ''}>
  <h2>${text(p.name)}</h2>
  <p class="subject">Subject: ${text(p.email.subject)}</p>
${p.note ? `  <p class="note">⚠ ${text(p.note)}</p>` : ''}
  <div class="frames">
    <div class="frame desktop"><header>Desktop · 700px</header><iframe srcdoc="${attr(p.email.html)}"></iframe></div>
    <div class="frame mobile"><header>Mobile · 375px</header><iframe srcdoc="${attr(p.email.html)}"></iframe></div>
    <div><header style="font-size:12px;color:#71717a;padding:6px 0;">Plain-text part</header><pre>${text(p.email.text)}</pre></div>
  </div>
</section>`,
  )
  .join('\n')}
<script>
  document.querySelectorAll('nav button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('nav button').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('section').forEach(function (s) { s.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById(btn.dataset.target).classList.add('active');
    });
  });
</script>
</body>
</html>`;

const outPath = join(__dirname, '..', 'email-previews.html');
writeFileSync(outPath, page, 'utf8');
console.log(`Wrote ${previews.length} previews to ${outPath}`);
