-- AlterTable
ALTER TABLE "tasks" ALTER COLUMN "due_date" TYPE DATE USING "due_date"::date;
