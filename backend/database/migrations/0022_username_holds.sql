CREATE TABLE "comment_mentions" (
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" text NOT NULL,
	CONSTRAINT "comment_mentions_comment_id_handle_pk" PRIMARY KEY("comment_id","handle")
);
--> statement-breakpoint
CREATE TABLE "username_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"username" text,
	"username_key" text NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"held_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_key" text GENERATED ALWAYS AS (translate(replace(replace(lower(username), '.', ''), '_', ''), '01', 'ol')) STORED;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "username_history" ADD CONSTRAINT "username_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_mentions_user_idx" ON "comment_mentions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "username_history_key_idx" ON "username_history" USING btree ("username_key","held_until");--> statement-breakpoint
CREATE INDEX "username_history_user_idx" ON "username_history" USING btree ("user_id");--> statement-breakpoint
/*
 * Lookalikes that already exist (`ada.l` beside `ada_l`) would stop the
 * unique index below. The earliest account keeps its name; each later one
 * gets the lowest free numeric suffix, as 0012 did, and is asked to confirm
 * or change it the next time they sign in. Each rename is noted for this
 * session, so the mention backfill below still finds `@ada_l` in old
 * comments. A plain index makes each free-name check a lookup rather than
 * a scan, until the unique one replaces it.
 */
CREATE TEMPORARY TABLE "username_renames" ("user_id" uuid NOT NULL, "old_username" text NOT NULL);--> statement-breakpoint
CREATE INDEX "users_username_key_tmp" ON "users" USING btree ("username_key");--> statement-breakpoint
DO $$
DECLARE
	r record;
	base text;
	candidate text;
	n int;
BEGIN
	FOR r IN
		SELECT id, username FROM (
			SELECT id, username,
				row_number() OVER (PARTITION BY username_key ORDER BY created_at, id) AS rn
			FROM users
		) ranked
		WHERE rn > 1
	LOOP
		n := 2;
		LOOP
			base := rtrim(left(r.username, 30 - length(n::text)), '._');
			candidate := base || n::text;
			EXIT WHEN NOT EXISTS (
				SELECT 1 FROM users
				WHERE username_key = translate(replace(replace(lower(candidate), '.', ''), '_', ''), '01', 'ol')
			);
			n := n + 1;
		END LOOP;
		INSERT INTO username_renames (user_id, old_username) VALUES (r.id, r.username);
		UPDATE users SET username = candidate WHERE id = r.id;
	END LOOP;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key_key" ON "users" USING btree ("username_key");--> statement-breakpoint
DROP INDEX "users_username_key_tmp";--> statement-breakpoint
/*
 * Comments written before this migration get their mentions resolved now,
 * against today's usernames (and the names the step above just changed)
 * and members, with the same grammar as `shared/contracts/src/mentions.ts`.
 * The character class is spelled out because Postgres `\w` follows the
 * locale and JavaScript's does not. A rename before today cannot be undone
 * in hindsight; from here on, mentions are resolved as they are written.
 */
INSERT INTO "comment_mentions" ("comment_id", "user_id", "handle")
SELECT c.id, u.id, lower(m.parts[2])
FROM "comments" c
CROSS JOIN LATERAL regexp_matches(
	c.body, '(^|[^A-Za-z0-9_@.-])@([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)', 'gi'
) AS m(parts)
JOIN "users" u ON u.username = lower(m.parts[2])
	OR u.id IN (SELECT user_id FROM username_renames WHERE old_username = lower(m.parts[2]))
JOIN "workspace_members" wm ON wm.workspace_id = c.workspace_id AND wm.user_id = u.id
WHERE c.body LIKE '%@%'
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TABLE "username_renames";
