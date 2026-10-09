CREATE INDEX "audit_events_workspace_actor_seq_idx" ON "audit_events" USING btree ("workspace_id","actor_id","seq");--> statement-breakpoint
CREATE INDEX "audit_events_workspace_entity_seq_idx" ON "audit_events" USING btree ("workspace_id","entity_type","seq");--> statement-breakpoint
/*
 * Deletes are allowed only once the workspace itself is gone.
 *
 * The first version allowed any delete arriving from inside a trigger
 * (`pg_trigger_depth() > 1`), meant for the foreign key's cascade. That also
 * admitted a delete from any other trigger or function. Asking whether the
 * parent still exists allows exactly the cascade: by the time it removes the
 * events, the workspace row is already deleted in the same transaction.
 */
CREATE OR REPLACE FUNCTION "audit_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = OLD.workspace_id) THEN
		RETURN OLD;
	END IF;

	RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;--> statement-breakpoint
/*
 * Row triggers do not fire on TRUNCATE, which would otherwise empty the
 * trail in one statement -- including a `TRUNCATE workspaces CASCADE`.
 */
CREATE FUNCTION "audit_events_no_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_events cannot be truncated' USING ERRCODE = 'insufficient_privilege';
END
$$;--> statement-breakpoint
CREATE TRIGGER "audit_events_no_truncate"
	BEFORE TRUNCATE ON "audit_events"
	FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_no_truncate"();--> statement-breakpoint
-- `to_char` and `convert_to` are STABLE, so the function cannot honestly be IMMUTABLE.
ALTER FUNCTION "robis_audit_hash"(text, uuid, bigint, uuid, text, text, text, uuid, text, text, timestamptz) STABLE;
