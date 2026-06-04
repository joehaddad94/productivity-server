# CLAUDE.md — Agent Workflow Rules

## Repo layout
- **Client**: `C:\Users\Joe\Desktop\productivity-client` (Next.js)
- **Server**: `C:\Users\Joe\Desktop\productivity-server` (NestJS)

## Active branches (as of 2026-05-18)
- `general` — client working branch
- `optimizations` — server working branch
- `development` — integration branch (both repos)
- `main` — stable release

## Branch & PR rules
1. All work goes on the active branch of the respective repo.
2. When ready to push a completed feature:
   - `git add -A && git commit -m "<conventional commit message>"`
   - `git push origin <branch>`
   - Open a PR **branch → development** on GitHub via the API.
3. **Never force-push.** Never push directly to `main` or `development`.

## Commit message convention
`feat(<scope>): <description>` / `fix(<scope>): <description>` / `chore(<scope>): <description>`

## Server module structure
`src/<feature>/<feature>.module.ts|controller.ts|service.ts|dto/`

## Shell note
Use PowerShell or cmd.exe — NOT Git Bash / WSL.
`gh` CLI is not available; use `git` for VCS and GitHub REST API for PRs.

## Performance rules (learned from benchmarks)
- Never put N sequential Prisma calls inside `$transaction` — use a raw `CASE WHEN` query or `Promise.all` instead
- For existence checks, use `findFirst` with `select: { id: true }` — never `findOne` which fetches full relations
- Parallelise independent DB writes with `Promise.all`
- assertMember is cached (TTL 60s) — calling it twice in one request is free on cache hits

## Useful scripts
- `npm run otel:test-connection` — verify Grafana OTLP endpoint is reachable
- `npm run otel:test-export` — send a real span to Grafana and confirm it arrives
- `npm run grafana:check-data` — query live Prometheus metrics for tasky-server
- `npm run grafana:sync-dashboard` — push the API performance dashboard to Grafana Cloud
- `node scripts/benchmark-tasks-vs-projects.mjs` — compare endpoint response times

## What's been built (all shipped)
- Roles: owner / admin / member with permission guards
- Task assignment with visibility filtering
- Member management UI
- Assignment notifications + due-date reminders
- Comments & activity log per task
- Team analytics tab
- Recurring tasks
- Google + Microsoft Calendar OAuth
- Notifications (in-app bell, push, email)
- Pomodoro per-task focus minutes
- Sentry error monitoring
- Rate limiting (`@nestjs/throttler`)
- TTL caching for JWT sessions and workspace membership
- Composite DB indexes
- Parallel DB queries on all list endpoints
- OpenTelemetry → Grafana Cloud (traces + metrics)
- `project { id, name }` embedded in task list response
- SSE real-time sync (`src/sse/`) — `GET /sse/workspace/:id`; `SseService` emits after every TasksService mutation; client invalidates TanStack Query on each event

## Pending
- CSP headers (helmet not installed)
- CI/CD pipeline (GitHub Actions)
- Marketing site pages (`/`, `/features`, `/pricing`, `/docs`)
- In-app onboarding modal
- API retry logic on the client
