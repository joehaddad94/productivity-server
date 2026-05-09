-- DropIndex
DROP INDEX "notifications_user_id_workspace_id_idx";

-- CreateIndex
CREATE INDEX "notifications_user_id_workspace_id_created_at_idx" ON "notifications"("user_id", "workspace_id", "created_at" DESC);
