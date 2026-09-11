-- Support the case-insensitive `contains` searches that tasks and notes run.
--
-- TasksService.list and NotesService.list both filter with
-- `{ contains: query, mode: 'insensitive' }`, which Prisma compiles to ILIKE
-- '%term%'. A leading wildcard cannot use a btree index, so both were
-- sequential scans that grow with the workspace.
--
-- GIN + pg_trgm handles infix ILIKE. Indexing titles only: task descriptions
-- and note content are unbounded free text (note content is HTML, and can
-- carry base64 images), so indexing them would cost far more than the search
-- quality it buys.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "tasks_title_trgm_idx"
  ON "tasks" USING gin ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "notes_title_trgm_idx"
  ON "notes" USING gin ("title" gin_trgm_ops);
