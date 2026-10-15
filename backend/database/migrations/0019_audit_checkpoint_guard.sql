/*
 * A checkpoint is evidence of how far a trail reached, so like the stream
 * cursor it may only move forward, never past the newest event, and goes
 * only with its workspace. Otherwise anyone who can write it could put back
 * an older, genuinely signed checkpoint, or remove it, after cutting the
 * trail back, and the cut would go unreported.
 */
CREATE FUNCTION "audit_checkpoint_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = OLD.workspace_id) THEN
			RETURN OLD;
		END IF;
		RAISE EXCEPTION 'audit_checkpoints rows go only with their workspace' USING ERRCODE = 'insufficient_privilege';
	END IF;
	IF TG_OP = 'UPDATE' AND NEW.seq < OLD.seq THEN
		RAISE EXCEPTION 'audit_checkpoints may only move forward' USING ERRCODE = 'insufficient_privilege';
	END IF;
	IF NEW.seq > coalesce((SELECT max(seq) FROM "audit_events" WHERE workspace_id = NEW.workspace_id), 0) THEN
		RAISE EXCEPTION 'audit_checkpoints cannot pass the newest event' USING ERRCODE = 'insufficient_privilege';
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "audit_checkpoint_guard"
	BEFORE INSERT OR UPDATE OR DELETE ON "audit_checkpoints"
	FOR EACH ROW EXECUTE FUNCTION "audit_checkpoint_guard"();