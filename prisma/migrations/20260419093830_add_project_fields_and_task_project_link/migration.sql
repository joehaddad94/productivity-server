-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "color" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "project_id" TEXT;

-- CreateIndex
CREATE INDEX "tasks_workspace_id_project_id_idx" ON "tasks"("workspace_id", "project_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
