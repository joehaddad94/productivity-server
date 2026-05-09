-- CreateIndex
CREATE INDEX "notes_workspace_id_updated_at_idx" ON "notes"("workspace_id", "updated_at");

-- CreateIndex
CREATE INDEX "projects_workspace_id_deleted_at_idx" ON "projects"("workspace_id", "deleted_at");

-- CreateIndex
CREATE INDEX "tasks_workspace_id_deleted_at_idx" ON "tasks"("workspace_id", "deleted_at");
