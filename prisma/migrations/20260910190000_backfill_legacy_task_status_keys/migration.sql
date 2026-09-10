-- Backfill pre-migration `tasks.status` values that still hold a bare status key
-- ('pending' / 'in_progress' / 'completed') instead of a workspace_task_statuses id.
--
-- See docs/task-model-and-rollup.md §6.1: the canonical mapper tolerates both
-- shapes, and it continues to after this runs, but carrying two representations
-- of the same thing indefinitely invites exactly the kind of drift that made
-- isTerminal() and resolveBucket() disagree. Live count when written: 14 rows
-- (pending x12, completed x1, in_progress x1) out of 1083 non-deleted tasks.
--
-- Data-only and idempotent: re-running matches nothing because the join
-- requires tasks.status to still equal a bare key. Rows whose workspace has no
-- status row with that key are deliberately left untouched rather than guessed
-- at; the mapper still resolves them.

UPDATE tasks AS t
SET status = wts.id
FROM workspace_task_statuses AS wts
WHERE wts.workspace_id = t.workspace_id
  AND wts.key = t.status
  AND wts.archived_at IS NULL
  AND t.status IN ('pending', 'in_progress', 'completed');
