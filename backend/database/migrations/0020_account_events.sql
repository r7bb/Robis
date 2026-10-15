CREATE TABLE "account_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"event_type" text NOT NULL,
	"payload" text DEFAULT '{}' NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"key_id" text NOT NULL,
	CONSTRAINT "account_events_key_id_format" CHECK ("account_events"."key_id" ~ '^[a-z0-9-]{1,32}$')
);
--> statement-breakpoint
ALTER TABLE "account_events" ADD CONSTRAINT "account_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_events_user_seq_key" ON "account_events" USING btree ("user_id","seq");--> statement-breakpoint
/*
 * An account's trail is append-only, like a workspace's: rows go only when
 * the account itself does (the cascade), and never by TRUNCATE.
 */
CREATE FUNCTION "account_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = OLD.user_id) THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'account_events is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;--> statement-breakpoint
CREATE TRIGGER "account_events_append_only"
	BEFORE UPDATE OR DELETE ON "account_events"
	FOR EACH ROW EXECUTE FUNCTION "account_events_append_only"();--> statement-breakpoint
CREATE TRIGGER "account_events_no_truncate"
	BEFORE TRUNCATE ON "account_events"
	FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_no_truncate"();