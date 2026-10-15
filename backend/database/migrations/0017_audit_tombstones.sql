CREATE TABLE "audit_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"head_seq" bigint NOT NULL,
	"head_hash" text,
	"deleted_by" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_key_id_format" CHECK ("audit_events"."key_id" is null or "audit_events"."key_id" ~ '^[a-z0-9-]{1,32}$');--> statement-breakpoint
/*
 * Deleting a workspace takes its trail with it (the cascade). Before it
 * goes, record how long the trail was and how it ended, so the deletion
 * itself leaves a trace. SECURITY DEFINER: it runs with the owner's rights,
 * because the runtime role may only read the tombstones. The search path is
 * pinned so nothing the caller sets can redirect the names inside it.
 */
CREATE FUNCTION "audit_tombstone_workspace"() RETURNS trigger
	LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
	INSERT INTO "audit_tombstones" ("workspace_id", "head_seq", "head_hash", "deleted_by")
	SELECT OLD.id, coalesce(max(e.seq), 0),
		(SELECT h.hash FROM "audit_events" h WHERE h.workspace_id = OLD.id ORDER BY h.seq DESC LIMIT 1),
		session_user
	FROM "audit_events" e WHERE e.workspace_id = OLD.id;
	RETURN OLD;
END
$$;--> statement-breakpoint
CREATE TRIGGER "workspaces_audit_tombstone"
	BEFORE DELETE ON "workspaces"
	FOR EACH ROW EXECUTE FUNCTION "audit_tombstone_workspace"();--> statement-breakpoint
/* Tombstones are written once and kept, like the trail. */
CREATE FUNCTION "audit_tombstones_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_tombstones is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;--> statement-breakpoint
CREATE TRIGGER "audit_tombstones_append_only"
	BEFORE UPDATE OR DELETE ON "audit_tombstones"
	FOR EACH ROW EXECUTE FUNCTION "audit_tombstones_append_only"();--> statement-breakpoint
CREATE TRIGGER "audit_tombstones_no_truncate"
	BEFORE TRUNCATE ON "audit_tombstones"
	FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_no_truncate"();--> statement-breakpoint
/*
 * The stream cursor is the one outside copy verification can see, so it may
 * only move forward, never past the newest event, and goes only with its
 * workspace. Otherwise anyone who can write it could make a healthy trail
 * read as truncated, or hide a real truncation.
 */
CREATE FUNCTION "audit_stream_cursor_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = OLD.workspace_id) THEN
			RETURN OLD;
		END IF;
		RAISE EXCEPTION 'audit_stream_cursors rows go only with their workspace' USING ERRCODE = 'insufficient_privilege';
	END IF;
	IF TG_OP = 'UPDATE' AND NEW.delivered_seq < OLD.delivered_seq THEN
		RAISE EXCEPTION 'audit_stream_cursors may only move forward' USING ERRCODE = 'insufficient_privilege';
	END IF;
	IF NEW.delivered_seq > coalesce((SELECT max(seq) FROM "audit_events" WHERE workspace_id = NEW.workspace_id), 0) THEN
		RAISE EXCEPTION 'audit_stream_cursors cannot pass the newest event' USING ERRCODE = 'insufficient_privilege';
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "audit_stream_cursor_guard"
	BEFORE INSERT OR UPDATE OR DELETE ON "audit_stream_cursors"
	FOR EACH ROW EXECUTE FUNCTION "audit_stream_cursor_guard"();