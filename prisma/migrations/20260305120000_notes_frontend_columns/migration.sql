-- Align notes table with frontend: content (renamed from description), tags, lastEdited from updated_at
-- Frontend expects: id, title, preview (or content), tags, lastEdited; backend keeps workspace_id, timestamps

-- Rename description -> content (full note body; API can derive preview from content when needed)
ALTER TABLE "notes" RENAME COLUMN "description" TO "content";

-- Add tags array for list/editor badges and filter/search
ALTER TABLE "notes" ADD COLUMN "tags" TEXT[] DEFAULT '{}';
