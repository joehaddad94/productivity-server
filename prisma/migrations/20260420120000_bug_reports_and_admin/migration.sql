-- Admin flag on users + in-app bug reports

ALTER TABLE "users" ADD COLUMN "is_admin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "is_admin" = true WHERE lower("email") = 'joehaddad94@gmail.com';

CREATE TABLE "bug_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expected" TEXT,
    "actual" TEXT,
    "route" TEXT,
    "user_agent" TEXT,
    "context_json" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bug_reports_user_id_created_at_idx" ON "bug_reports"("user_id", "created_at");
CREATE INDEX "bug_reports_status_created_at_idx" ON "bug_reports"("status", "created_at");
CREATE INDEX "bug_reports_workspace_id_idx" ON "bug_reports"("workspace_id");

ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
