-- Drop the per-member "see all tasks" escape hatch.
-- Task visibility is now derived purely from role + assignment state:
--   owner/admin see every assigned task plus their own; members see tasks
--   assigned to them plus tasks they created. No member ever sees another
--   member's unassigned (private) task, so this flag no longer has meaning.
ALTER TABLE "workspace_members" DROP COLUMN "can_see_all_tasks";
