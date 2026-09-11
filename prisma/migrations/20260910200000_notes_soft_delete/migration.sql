-- Give notes the same soft delete Task, Project and User already have.
--
-- NotesService.remove() called prisma.note.delete(), a hard delete, so an
-- accidental note deletion was permanent with nothing to restore from — while
-- deleting a task or a project has always been recoverable.
--
-- Additive and safe to run on live data: existing rows get NULL, which is
-- exactly "not deleted".

ALTER TABLE "notes" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "notes_workspace_id_deleted_at_idx" ON "notes"("workspace_id", "deleted_at");
