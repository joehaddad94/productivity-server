-- Workspace-scoped task status definitions (columns / workflow).

CREATE TABLE "workspace_task_statuses" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_terminal" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_task_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_task_statuses_workspace_id_key_key" ON "workspace_task_statuses"("workspace_id", "key");

CREATE INDEX "workspace_task_statuses_workspace_id_sort_order_idx" ON "workspace_task_statuses"("workspace_id", "sort_order");

ALTER TABLE "workspace_task_statuses" ADD CONSTRAINT "workspace_task_statuses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed three built-in statuses per workspace (UUID ids).
INSERT INTO "workspace_task_statuses" ("id", "workspace_id", "key", "name", "sort_order", "is_terminal", "color", "archived_at", "created_at")
SELECT gen_random_uuid(), w."id", v.key, v.name, v.sort_order, v.is_terminal, NULL, NULL, CURRENT_TIMESTAMP
FROM "workspaces" w
CROSS JOIN (
  VALUES
    ('pending', 'Pending', 0, false),
    ('in_progress', 'In progress', 1, false),
    ('completed', 'Completed', 2, true)
) AS v(key, name, sort_order, is_terminal);

-- Point tasks at the new status row ids (status column stores id string).
UPDATE "tasks" t
SET "status" = wts."id"
FROM "workspace_task_statuses" wts
WHERE t."workspace_id" = wts."workspace_id"
  AND wts."key" = t."status"
  AND t."status" IN ('pending', 'in_progress', 'completed');
