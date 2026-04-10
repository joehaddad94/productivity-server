# CLAUDE.md — Agent Workflow Rules

## Repo layout
- **Client**: `C:\Users\Joe\Desktop\productivity-client` (Next.js, branch `agent`)
- **Server**: `C:\Users\Joe\Desktop\productivity-server` (NestJS, branch `agent`)

## Branch & PR rules (permit/notify flow)
1. All work goes on the **`agent`** branch of the respective repo.
2. When ready to push a completed feature:
   - `git add -A && git commit -m "<conventional commit message>"`
   - `git push origin agent`
   - Open a PR **agent → development** on GitHub via the API (title = commit subject).
3. **Never force-push.** Never push directly to `main` or `development`.
4. After opening the PR, update `C:\Users\Joe\.claude\projects\...\memory\progress.md`
   with the feature status and PR link.

## Commit message convention
`feat(<scope>): <description>` / `fix(<scope>): <description>` / `chore(<scope>): <description>`

## Server module structure
`src/<feature>/<feature>.module.ts|controller.ts|service.ts|dto/`

## Shell note
Use PowerShell or cmd.exe for all commands — NOT Git Bash / WSL.
`gh` CLI is not available; use `git` only for VCS. Use the GitHub REST API (via the
provided MCP tools or curl with the token in env) to open PRs.

## Current backlog (in priority order)
1. ~~Pomodoro per-task focus minutes~~ ✅
2. **Notifications & Reminders** (next — see below)
3. Recurring tasks
4. Team / workspace sharing

## Notifications & Reminders — spec
### Server (`productivity-server`, NestJS)
- Install `@nestjs/schedule` + `node-cron`; add `ScheduleModule.forRoot()` to `AppModule`
- `NotificationsModule` with:
  - `Notification` Prisma model: `id, userId, taskId?, title, body, type (DUE_SOON|OVERDUE|DAILY_AGENDA), read, createdAt`
  - Migration: `add_notifications_table`
  - `NotificationsService`:
    - `getUserNotifications(userId)` — list unread, newest first
    - `markRead(id, userId)` — mark single notification read
    - `markAllRead(userId)`
    - `createNotification(dto)` — internal
  - `NotificationsController`: `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`
  - `RemindersScheduler` (`@Injectable()`, uses `@Cron`):
    - Every minute: find tasks with `dueDate` within the next 60 min + no `DUE_SOON` notification today → create notification
    - Every minute: find tasks with `dueDate` < now + no `OVERDUE` notification today → create notification
    - Daily at 08:00 Beirut time (`@Cron('0 8 * * *', { timeZone: 'Asia/Beirut' })`): per-user daily agenda summary
- Unit test `RemindersScheduler` with mocked `PrismaService` and mocked `Date`

### Client (`productivity-client`, Next.js)
- `Notification` type + `notificationsApi` + hooks
- Bell icon in header with unread badge, dropdown panel, mark-all-read
- Settings page: replace "coming soon" placeholder with real notification preference toggles
- e2e: `e2e/notifications.spec.ts`
