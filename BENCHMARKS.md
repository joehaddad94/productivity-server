# API Benchmarks

Methodology: 5 calls per endpoint after 1 warm-up call, measured end-to-end from localhost client.  
Server: NestJS + Prisma ORM, Supabase PostgreSQL (remote).  
Auth: HttpOnly cookie via `dev-session`.

---

## 2026-05-09

| Endpoint | Min | P50 | Avg | Max |
|---|---:|---:|---:|---:|
| `GET /health` | 18ms | 18ms | 19ms | 21ms |
| `GET /auth/me` | 522ms | 550ms | 557ms | 596ms |
| `GET /notifications/vapid-public-key` | 522ms | 526ms | 548ms | 594ms |
| `GET /workspaces/:id/notifications/unread-count` | 800ms | 879ms | 893ms | 1012ms |
| `GET /workspaces` | 1037ms | 1068ms | 1058ms | 1072ms |
| `GET /workspaces/:id` | 1020ms | 1041ms | 1051ms | 1094ms |
| `GET /workspaces/:id/notes/:id` | 1045ms | 1071ms | 1076ms | 1116ms |
| `GET /workspaces/:id/projects/:id` | 1071ms | 1153ms | 1182ms | 1282ms |
| `GET /workspaces/:id/tags` | 1024ms | 1373ms | 1255ms | 1436ms |
| `GET /calendar-connections` | 781ms | 1117ms | 1136ms | 1382ms |
| `GET /workspaces/:id/members` | 1283ms | 1360ms | 1333ms | 1369ms |
| `GET /workspaces/:id/task-statuses` | 1282ms | 1328ms | 1340ms | 1459ms |
| `GET /workspaces/:id/tasks/:id` | 1325ms | 1418ms | 1582ms | 2045ms |
| `GET /workspaces/:id/analytics` | 1382ms | 1466ms | 1496ms | 1644ms |
| `GET /workspaces/:id/notifications` | 1683ms | 1747ms | 1747ms | 1811ms |
| `GET /workspaces/:id/projects` | 1790ms | 1837ms | 1881ms | 2118ms |
| `GET /workspaces/:id/notes` | 1808ms | 1881ms | 1886ms | 1960ms |
| `GET /notifications/settings` | 1840ms | 1857ms | 1870ms | 1932ms |
| `GET /workspaces/:id/tasks` | 2043ms | 2202ms | 2203ms | 2360ms |

### Observations

- Every authenticated endpoint carries ~550ms of JWT guard overhead (2 DB round-trips: `session.findUnique` + `user.findById` against remote Supabase).
- `/health` is the only unauthenticated endpoint and confirms the base network latency is ~18ms.
- List endpoints (`/tasks`, `/notes`, `/projects`, `/notifications`) are the slowest at 1.7–2.2s — likely due to heavy joins on top of the auth overhead.
- `GET /tasks` is the slowest overall at 2.2s avg.

### Known pending improvements

- **#1** ✅ Resolved in 2026-05-10 benchmark below.

---

## 2026-05-10 — After JWT session cache

Change: added `TtlCache` (30s TTL, max 1000 entries) in `JwtStrategy.validate()`.  
Cache hit skips both DB round-trips. Logout calls `sessionCache.delete(jti)` immediately.

| Endpoint | Min | P50 | Avg | Max | vs 2026-05-09 |
|---|---:|---:|---:|---:|---:|
| `GET /auth/me` | 21ms | 22ms | 22ms | 24ms | **-535ms** |
| `GET /workspaces/:id/notifications/unread-count` | 275ms | 279ms | 280ms | 290ms | -613ms |
| `GET /calendar-connections` | 274ms | 282ms | 284ms | 299ms | -852ms |
| `GET /workspaces` | 526ms | 534ms | 549ms | 619ms | -509ms |
| `GET /workspaces/:id` | 518ms | 530ms | 537ms | 564ms | -514ms |
| `GET /workspaces/:id/analytics` | 776ms | 780ms | 807ms | 906ms | -689ms |
| `GET /workspaces/:id/task-statuses` | 773ms | 795ms | 796ms | 818ms | -544ms |
| `GET /workspaces/:id/notifications` | 1025ms | 1037ms | 1038ms | 1052ms | -709ms |
| `GET /workspaces/:id/notes` | 1279ms | 1285ms | 1300ms | 1369ms | -586ms |
| `GET /workspaces/:id/projects` | 1276ms | 1347ms | 1412ms | 1770ms | -469ms |
| `GET /notifications/settings` | 1285ms | 1322ms | 1326ms | 1383ms | -544ms |
| `GET /workspaces/:id/tasks` | 1559ms | 1589ms | 1589ms | 1620ms | -614ms |

### Observations

- JWT guard overhead eliminated on cache hits: ~550ms → ~0ms per authenticated request.
- Remaining latency is pure DB query cost against remote Supabase.
- List endpoints (`/tasks` 1.6s, `/notes` 1.3s, `/projects` 1.4s) are next to investigate — likely heavy joins or missing indexes.
