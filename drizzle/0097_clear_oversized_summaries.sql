-- Clear summaries that are not strictly shorter than the original
-- article content, mark those rows as `summary_unnecessary` so we don't
-- keep retrying summarization for them, and clear the duplicated post
-- summary for original-language rows.
UPDATE "post" AS p
SET "summary" = NULL
FROM "article_content" AS ac
WHERE p."article_source_id" = ac."source_id"
  AND p."language" = ac."language"
  AND ac."original_language" IS NULL
  AND ac."summary" IS NOT NULL
  AND char_length(
        regexp_replace(ac."summary", '^[[:space:]]+|[[:space:]]+$', '', 'g')
      ) >= char_length(
        regexp_replace(ac."content", '^[[:space:]]+|[[:space:]]+$', '', 'g')
      );
--> statement-breakpoint
UPDATE "article_content"
SET "summary" = NULL,
    "summary_unnecessary" = TRUE,
    "summary_started" = NULL
WHERE "summary" IS NOT NULL
  AND char_length(
        regexp_replace("summary", '^[[:space:]]+|[[:space:]]+$', '', 'g')
      ) >= char_length(
        regexp_replace("content", '^[[:space:]]+|[[:space:]]+$', '', 'g')
      );
