-- A plain-text mirror of note content, for search.
--
-- NotesService.list searched `content`, which stores TipTap's HTML. Searching
-- "img", "div" or "span" therefore matched the markup of nearly every note,
-- and the base64 image payloads embedded in the body were searched too.
--
-- Maintained on write by the service. Backfilled here by stripping tags and
-- decoding the handful of entities TipTap emits, which is approximate but far
-- closer to what a user means by "search my notes" than raw HTML.

ALTER TABLE "notes" ADD COLUMN "content_text" TEXT;

UPDATE "notes"
SET "content_text" = NULLIF(
  btrim(
    regexp_replace(
      regexp_replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  -- Close block-level tags to a space so "<p>a</p><p>b</p>"
                  -- does not become "ab".
                  regexp_replace("content", '</(p|div|li|h[1-6]|blockquote|pre|tr)>', ' ', 'gi'),
                  '&nbsp;', ' '),
                '&amp;', '&'),
              '&lt;', '<'),
            '&gt;', '>'),
          '&quot;', '"'),
        '<[^>]+>', '', 'g'),      -- drop every remaining tag
      '\s+', ' ', 'g'             -- collapse whitespace
    )
  ),
  ''
)
WHERE "content" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "notes_content_text_trgm_idx"
  ON "notes" USING gin ("content_text" gin_trgm_ops);
