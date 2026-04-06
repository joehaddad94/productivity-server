-- Add sort_order column to tasks table with default 0
ALTER TABLE "tasks" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Initialize sort_order from creation order per workspace
-- so existing tasks get a meaningful initial order
UPDATE "tasks" t
SET "sort_order" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at ASC) AS rn
  FROM tasks
) sub
WHERE t.id = sub.id;
