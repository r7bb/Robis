ALTER TABLE "issues" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
-- Issues already done: when the audit trail last saw one moved to done, or,
-- filed as done, when it was filed. Never its last edit, which could make
-- old work look like this week's.
UPDATE "issues" AS i SET "completed_at" = coalesce(
  (
    SELECT max(a.created_at) FROM audit_events a
    WHERE a.workspace_id = i.workspace_id
      AND a.entity_type = 'issue'
      AND a.entity_id = i.id
      AND a.event_type = 'issue.status_changed'
      AND a.payload LIKE '%"to":"DONE"%'
  ),
  i.created_at
)
WHERE i.status = 'DONE';--> statement-breakpoint
-- Done is a moment (Phase 2c): stamped when an issue becomes done, cleared
-- when it leaves done, whichever write path moved it. A value given on
-- insert (a seed, an import) is kept.
CREATE FUNCTION issues_completed_at() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'DONE' THEN
    NEW.completed_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.completed_at := coalesce(NEW.completed_at, now());
  ELSIF OLD.status <> 'DONE' THEN
    NEW.completed_at := now();
  ELSE
    -- Still done: kept, unless a value is given (a correction, a test).
    NEW.completed_at := coalesce(NEW.completed_at, OLD.completed_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER issues_completed_at
  BEFORE INSERT OR UPDATE ON issues
  FOR EACH ROW EXECUTE FUNCTION issues_completed_at();