-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "remind_at" TIMESTAMP(3),
ADD COLUMN     "remind_sent_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "tasks_remind_at_remind_sent_at_idx" ON "tasks"("remind_at", "remind_sent_at");
