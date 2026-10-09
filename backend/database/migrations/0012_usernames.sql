ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
/*
 * Give every existing account a username.
 *
 * Derived from the email's local part, reduced to the characters a username
 * may hold, then made unique by appending a number when the name is taken or
 * too short. Done one row at a time against what is already assigned, so a
 * derived "ada2" can never collide with a real "ada2". Reserved names get a
 * number too. People can change theirs afterwards; this only has to be valid
 * and unique.
 */
DO $$
DECLARE
	r record;
	base text;
	candidate text;
	n int;
	-- Kept equal to RESERVED_USERNAMES in shared/contracts/src/usernames.ts.
	reserved text[] := ARRAY['abuse','admin','administrator','all','api','billing','channel',
		'everyone','help','here','legal','me','mod','moderator','noreply','null','owner',
		'postmaster','privacy','robis','root','security','staff','support','system','team',
		'undefined','webmaster','www'];
BEGIN
	FOR r IN SELECT "id", "email" FROM "users" ORDER BY "created_at", "id" LOOP
		base := lower(split_part(r.email, '@', 1));
		base := regexp_replace(base, '[^a-z0-9._]', '', 'g');
		base := regexp_replace(base, '\.{2,}', '.', 'g');
		base := trim(both '._' from base);
		base := left(base, 24);
		base := trim(both '._' from base);
		IF base = '' THEN
			base := 'member';
		END IF;

		candidate := base;
		n := 1;
		WHILE length(candidate) < 3
			OR candidate = ANY(reserved)
			OR EXISTS (SELECT 1 FROM "users" WHERE "username" = candidate) LOOP
			n := n + 1;
			candidate := base || n::text;
		END LOOP;

		UPDATE "users" SET "username" = candidate WHERE "id" = r.id;
	END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree ("username");
