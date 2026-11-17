ALTER TABLE "issues" ADD COLUMN "position" text;--> statement-breakpoint
-- Existing cards keep the order the board showed them in, newest first: the
-- newest in each project becomes b00, the next b01, and so on, in the key
-- format the app's fractional keys use ('b' and two base-62 digits covers
-- 3,844 issues a project; any beyond that get 'c' and three).
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY number DESC) - 1 AS r
  FROM issues
),
digits AS (SELECT '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'::text AS d)
UPDATE issues SET position = CASE
  WHEN ranked.r < 3844 THEN
    'b' || substr(digits.d, (ranked.r / 62)::int + 1, 1) || substr(digits.d, (ranked.r % 62)::int + 1, 1)
  ELSE
    'c' || substr(digits.d, (ranked.r / 3844)::int + 1, 1)
        || substr(digits.d, ((ranked.r / 62) % 62)::int + 1, 1)
        || substr(digits.d, (ranked.r % 62)::int + 1, 1)
  END
FROM ranked, digits
WHERE issues.id = ranked.id;--> statement-breakpoint
ALTER TABLE "issues" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "issues_project_position_idx" ON "issues" USING btree ("project_id","position");
