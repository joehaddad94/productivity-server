-- Add performance indexes for common query patterns

-- Tasks: most queries filter by workspaceId; subtask queries filter by parentTaskId
CREATE INDEX "tasks_workspace_id_idx" ON "tasks"("workspace_id");
CREATE INDEX "tasks_workspace_id_status_idx" ON "tasks"("workspace_id", "status");
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks"("parent_task_id");

-- Notes: most queries filter by workspaceId; project filter is common
CREATE INDEX "notes_workspace_id_idx" ON "notes"("workspace_id");
CREATE INDEX "notes_workspace_id_project_id_idx" ON "notes"("workspace_id", "project_id");

-- Projects: all queries filter by workspaceId
CREATE INDEX "projects_workspace_id_idx" ON "projects"("workspace_id");

-- DailyStat: analytics queries by user across workspaces
CREATE INDEX "daily_stats_user_id_idx" ON "daily_stats"("user_id");
