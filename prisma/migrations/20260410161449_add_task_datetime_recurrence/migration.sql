-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "due_time" TEXT,
ADD COLUMN     "recurrence_parent_id" TEXT,
ADD COLUMN     "recurrence_rule" TEXT;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_parent_id_fkey" FOREIGN KEY ("recurrence_parent_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
