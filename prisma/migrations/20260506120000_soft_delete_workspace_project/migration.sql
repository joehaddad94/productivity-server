-- AlterTable: add soft-delete column to workspaces
ALTER TABLE "workspaces" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- AlterTable: add soft-delete column to projects
ALTER TABLE "projects" ADD COLUMN "deleted_at" TIMESTAMP(3);
