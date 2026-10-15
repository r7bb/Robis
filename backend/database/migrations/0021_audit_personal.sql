ALTER TABLE "audit_events" ADD COLUMN "personal" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "personal_salt" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "personal_subject_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "personal_commitment" text;--> statement-breakpoint
CREATE INDEX "audit_events_personal_subject_idx" ON "audit_events" USING btree ("personal_subject_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_personal_committed" CHECK (("audit_events"."personal" is null and "audit_events"."personal_salt" is null) or "audit_events"."personal_commitment" is not null);--> statement-breakpoint
/*
 * The trail stays append-only, with one exception: erasing the personal
 * fields of an event. That update may only set `personal`, `personal_salt`
 * and `personal_subject_id` to null, and must leave every other column,
 * the commitment included, exactly as it was; the chain hashes the
 * commitment, so it still verifies afterwards.
 */
CREATE OR REPLACE FUNCTION "audit_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "workspaces" WHERE "id" = OLD.workspace_id) THEN
		RETURN OLD;
	END IF;

	IF TG_OP = 'UPDATE'
		AND NEW.personal IS NULL AND NEW.personal_salt IS NULL AND NEW.personal_subject_id IS NULL
		AND NEW.id = OLD.id AND NEW.workspace_id = OLD.workspace_id AND NEW.seq = OLD.seq
		AND NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id AND NEW.actor_kind = OLD.actor_kind
		AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id
		AND NEW.entity_type = OLD.entity_type AND NEW.entity_id = OLD.entity_id
		AND NEW.event_type = OLD.event_type AND NEW.payload = OLD.payload
		AND NEW.created_at = OLD.created_at AND NEW.prev_hash IS NOT DISTINCT FROM OLD.prev_hash
		AND NEW.hash = OLD.hash AND NEW.key_id IS NOT DISTINCT FROM OLD.key_id
		AND NEW.personal_commitment IS NOT DISTINCT FROM OLD.personal_commitment
	THEN
		RETURN NEW;
	END IF;

	RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;