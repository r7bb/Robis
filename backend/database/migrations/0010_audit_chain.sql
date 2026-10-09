CREATE TYPE "public"."actor_kind" AS ENUM('human', 'agent', 'system');--> statement-breakpoint
CREATE TABLE "audit_stream_cursors" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"delivered_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "audit_events_workspace_created_idx";--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "seq" bigint;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_kind" "actor_kind" DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "hash" text;--> statement-breakpoint
ALTER TABLE "audit_stream_cursors" ADD CONSTRAINT "audit_stream_cursors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
/*
 * The chain hash, in SQL. The application computes the same thing in
 * `backend/database/src/audit.ts` for every new row; this copy exists to
 * backfill rows written before the chain did, and a test holds the two to
 * the same answer. Fields are joined by the ASCII unit separator, which
 * none of them can contain (payload is JSON, which escapes it).
 */
CREATE FUNCTION "robis_audit_hash"(
	prev_hash text, workspace_id uuid, seq bigint, actor_id uuid, actor_kind text,
	request_id text, entity_type text, entity_id uuid, event_type text, payload text,
	created_at timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
	SELECT encode(sha256(convert_to(concat_ws(E'\x1f',
		'v1',
		coalesce(prev_hash, ''),
		workspace_id::text,
		seq::text,
		coalesce(actor_id::text, ''),
		actor_kind,
		coalesce(request_id, ''),
		entity_type,
		entity_id::text,
		event_type,
		payload,
		to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
	), 'UTF8')), 'hex')
$$;--> statement-breakpoint
/*
 * Number first, at full precision, then truncate. Truncation keeps order but
 * creates ties, and a tie can only be broken by the random id. Rows that
 * already shared a timestamp still are -- nothing recorded their real order.
 * Millisecond precision is so the timestamp round-trips through a JavaScript
 * Date unchanged.
 */
WITH numbered AS (
	SELECT "id", row_number() OVER (PARTITION BY "workspace_id" ORDER BY "created_at", "id") AS n
	FROM "audit_events"
)
UPDATE "audit_events" e
SET "seq" = numbered.n, "created_at" = date_trunc('milliseconds', e."created_at")
FROM numbered WHERE e."id" = numbered."id";--> statement-breakpoint
DO $$
DECLARE
	r record;
	previous text;
	current_workspace uuid;
BEGIN
	FOR r IN SELECT * FROM "audit_events" ORDER BY "workspace_id", "seq" LOOP
		IF current_workspace IS DISTINCT FROM r.workspace_id THEN
			previous := NULL;
			current_workspace := r.workspace_id;
		END IF;

		UPDATE "audit_events"
		SET "prev_hash" = previous,
			"hash" = robis_audit_hash(previous, r.workspace_id, r.seq, r.actor_id, r.actor_kind::text,
				r.request_id, r.entity_type, r.entity_id, r.event_type, r.payload, r.created_at)
		WHERE "id" = r.id
		RETURNING "hash" INTO previous;
	END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "seq" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "hash" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_workspace_seq_key" ON "audit_events" USING btree ("workspace_id","seq");--> statement-breakpoint
/*
 * Append-only, enforced by the database rather than by convention.
 *
 * Updates are always refused. Deletes are refused unless they come from a
 * cascade (deleting the workspace), which runs inside the foreign key's own
 * trigger and so arrives one level deeper. This stops a mistaken query, not
 * a determined table owner, who can disable the trigger; the hash chain is
 * what catches that.
 */
CREATE FUNCTION "audit_events_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
		RETURN OLD;
	END IF;

	RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only"
	BEFORE UPDATE OR DELETE ON "audit_events"
	FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();
