-- Rate counts shared by every API instance (A6). Unlogged: no write-ahead
-- log for a counter rewritten on every request; a crash empties it, which
-- only forgives a few counts.
CREATE UNLOGGED TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
) WITH (fillfactor = 70);