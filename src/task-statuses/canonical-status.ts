import type { WorkspaceTaskStatus } from '@prisma/client';

/**
 * The small, fixed vocabulary the personal rollup (and cross-workspace analytics)
 * group by. Every per-workspace `WorkspaceTaskStatus` — built-in or custom — is
 * folded into one of these three buckets. See docs/task-model-and-rollup.md §6.1.
 */
export type CanonicalBucket = 'open' | 'in_progress' | 'done';

/**
 * Derive a canonical bucket from a status row's own fields:
 *   - terminal statuses (`completed` and any custom "done-like") -> done
 *   - the built-in `in_progress` -> in_progress
 *   - everything else (pending + custom, key = null, non-terminal) -> open
 */
export function deriveBucket(
  row: Pick<WorkspaceTaskStatus, 'key' | 'isTerminal'>,
): CanonicalBucket {
  if (row.isTerminal) return 'done';
  if (row.key === 'in_progress') return 'in_progress';
  return 'open';
}

/**
 * Map the raw legacy key strings still stored in a handful of `Task.status`
 * columns (pre-migration rows that predate status ids). Confirmed against live
 * data 2026-07-20: only `pending` / `in_progress` / `completed` occur.
 */
export function legacyKeyBucket(key: string): CanonicalBucket {
  if (key === 'completed') return 'done';
  if (key === 'in_progress') return 'in_progress';
  return 'open';
}

/**
 * Resolve a `Task.status` value to a canonical bucket, tolerating both shapes
 * that exist in the database:
 *   1. a `WorkspaceTaskStatus.id` (the value the create path writes today)
 *   2. a legacy bare key string (`pending` / `in_progress` / `completed`)
 *
 * @param status  the raw `Task.status` value
 * @param byId    lookup of status rows keyed by id, for the involved workspaces
 */
export function resolveBucket(
  status: string,
  byId: Map<string, Pick<WorkspaceTaskStatus, 'key' | 'isTerminal'>>,
): CanonicalBucket {
  const row = byId.get(status);
  if (row) return deriveBucket(row);
  return legacyKeyBucket(status);
}
