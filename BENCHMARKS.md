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

---

## 2026-05-10 — After membership cache + composite indexes + notifications fix

Changes:
1. `assertMember()` now checks `membershipCache` (60s TTL, max 5000) before firing `workspaceMember.findUnique`.  
2. Added composite indexes: `(workspaceId, deletedAt)` on Task and Project; `(workspaceId, updatedAt)` on Note.  
3. `getSettings()` uses `findUnique` first, only `create` on miss (eliminates upsert write-amplification).

| Endpoint | Min | P50 | Avg | Max | vs 2026-05-10 |
|---|---:|---:|---:|---:|---:|
| `GET /health` | 1ms | 2ms | 2ms | 3ms | — |
| `GET /auth/me` | 2ms | 4ms | 4ms | 7ms | **-18ms** |
| `GET /notifications/vapid-public-key` | 2ms | 3ms | 4ms | 7ms | **-18ms** |
| `GET /workspaces/:id/notifications/unread-count` | 256ms | 263ms | 266ms | 277ms | **-14ms** |
| `GET /workspaces` | 515ms | 524ms | 523ms | 529ms | -26ms |
| `GET /workspaces/:id` | 505ms | 511ms | 517ms | 540ms | **-20ms** |
| `GET /calendar-connections` | 254ms | 268ms | 267ms | 285ms | **-17ms** |
| `GET /workspaces/:id/members` | 774ms | 780ms | 789ms | 822ms | **-544ms** |
| `GET /workspaces/:id/task-statuses` | 507ms | 511ms | 516ms | 543ms | **-280ms** |
| `GET /workspaces/:id/tags` | 251ms | 252ms | 260ms | 281ms | **-1062ms** |
| `GET /workspaces/:id/analytics` | 509ms | 559ms | 571ms | 660ms | **-236ms** |
| `GET /notifications/settings` | 258ms | 259ms | 261ms | 270ms | **-1061ms** |
| `GET /workspaces/:id/notes` | 1008ms | 1039ms | 1043ms | 1083ms | **-257ms** |
| `GET /workspaces/:id/projects` | 1009ms | 1037ms | 1073ms | 1193ms | **-339ms** |
| `GET /workspaces/:id/notifications` | 1019ms | 1053ms | 1157ms | 1609ms | -19ms |
| `GET /workspaces/:id/tasks` | 1322ms | 1342ms | 1344ms | 1383ms | **-245ms** |
| `GET /workspaces/:id/notes/:id` | 252ms | 254ms | 254ms | 257ms | **-822ms** |

### Observations

- Membership cache hit eliminates 1 DB round-trip (~250–300ms) per workspace request. Most notable wins: `/tags` -1062ms, `/notifications/settings` -1061ms, `/task-statuses` -280ms.
- Composite indexes on `(workspaceId, deletedAt)` reduce task/project list scans; list endpoints now 1.0–1.3s.
- `GET /workspaces/:id/notifications` (1.0–1.6s) is the next bottleneck — wide join across notifications + users.
- `GET /workspaces` and `GET /workspaces/:id` still ~520ms — pure DB cost fetching workspace rows; no obvious further optimization without read replicas or app-level workspace cache.

---

## 2026-05-10 — After parallel reads + notes content exclusion

Changes:
1. All list endpoints: replaced `prisma.$transaction([findMany, count])` with `Promise.all([findMany, count])` — queries fire concurrently instead of sequentially.
2. Notes list: added `select` excluding the `content` field (only loaded in the editor, not the list view).

| Endpoint | Min | P50 | Avg | Max | vs prev |
|---|---:|---:|---:|---:|---:|
| `GET /health` | 2ms | 2ms | 2ms | 3ms | — |
| `GET /auth/me` | 3ms | 3ms | 3ms | 4ms | — |
| `GET /notifications/vapid-public-key` | 2ms | 2ms | 2ms | 3ms | — |
| `GET /workspaces/:id/notifications/unread-count` | 260ms | 269ms | 275ms | 302ms | — |
| `GET /workspaces` | 514ms | 529ms | 531ms | 548ms | — |
| `GET /workspaces/:id` | 518ms | 528ms | 540ms | 570ms | — |
| `GET /calendar-connections` | 259ms | 260ms | 260ms | 264ms | — |
| `GET /workspaces/:id/members` | 763ms | 776ms | 785ms | 812ms | — |
| `GET /workspaces/:id/task-statuses` | 503ms | 511ms | 516ms | 539ms | — |
| `GET /workspaces/:id/tags` | 251ms | 252ms | 262ms | 300ms | — |
| `GET /workspaces/:id/analytics` | 505ms | 512ms | 522ms | 556ms | **-49ms** |
| `GET /workspaces/:id/notifications` | 1028ms | 1075ms | 1171ms | 1612ms | — |
| `GET /workspaces/:id/notes` | 257ms | 260ms | 260ms | 266ms | **-783ms** |
| `GET /workspaces/:id/projects` | 256ms | 262ms | 264ms | 279ms | **-809ms** |
| `GET /notifications/settings` | 256ms | 270ms | 280ms | 337ms | — |
| `GET /workspaces/:id/tasks` | 512ms | 517ms | 526ms | 563ms | **-818ms** |
| `GET /workspaces/:id/notes/:id` | 254ms | 259ms | 258ms | 259ms | — |

### Observations

- Parallelising findMany + count eliminated one full DB round-trip (~250ms) from every list endpoint.
- `/tasks` dropped from 1344ms → 526ms (**-818ms**), `/notes` from 1043ms → 260ms (**-783ms**), `/projects` from 1073ms → 264ms (**-809ms**).
- All list endpoints now sit at ~260ms (1 round-trip) or ~530ms (2 round-trips). The floor is remote Supabase latency.
- Remaining outlier: `GET /workspaces/:id/notifications` still ~1.1s — heavier join. Everything else is at or near the network floor.


---

## 2026-05-18 — Focus time logging fix

**Change:** `POST /tasks/:id/log-focus` replaced `findOne` (full task with subtasks/assignees) with a lightweight existence check, and parallelised the two writes (`task.update` + `dailyStat.upsert`).

| Scenario | Before | After |
|---|---:|---:|
| `POST /tasks/:id/log-focus` | ~4–5s | ~500ms |

**Root cause:** `findOne` fetched the full task graph (subtasks + assignees via JOINs, ~1.5–2s) just to verify the task existed. Then two more sequential DB writes followed. Five round-trips total.  
**Fix:** one `assertMember` (cached), one `findFirst` with `select: {id}`, two parallel writes.

---

## 2026-05-18 — Task reorder fix

**Change:** `POST /tasks/reorder` replaced `$transaction([N × task.update])` with a single `UPDATE ... CASE WHEN` raw query.

| Scenario | Before | After |
|---|---:|---:|
| Reorder 32 tasks | 500 error (timeout) | 586ms |

**Root cause:** Prisma's `$transaction` runs operations sequentially. 32 updates × ~250ms remote latency = ~8s, exceeding the 5-second transaction timeout.  
**Fix:** single SQL statement, one round-trip regardless of task count.

---

## 2026-05-18 — Tasks page load: project embedding

**Change:** `GET /tasks` now includes `project: { id, name }` in each task, eliminating the separate `GET /projects` request on page load.

| Request | P50 |
|---|---:|
| `GET /tasks` (before embed) | 1575ms |
| `GET /projects` (eliminated) | 266ms |
| `GET /tasks` (after embed) | ~1579ms |

**Net effect:** one fewer request on page load. Cost of the additional JOIN is ~4ms — negligible against the remote Supabase latency floor.  
Projects are now fetched lazily only when a picker that needs the full list is opened (filter dropdown, task drawer, create modal).
