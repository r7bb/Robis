ALTER TABLE "issues" ADD COLUMN "cycle_added_at" timestamp with time zone;--> statement-breakpoint
-- When an issue joined its cycle: stamped whenever it is put in one, cleared
-- when it leaves, kept through other edits, whichever write path moved it.
-- Issues already in a cycle stay null, counted as planned from the start.
-- A value given while the cycle is unchanged is kept (a correction, a test).
CREATE FUNCTION issues_cycle_added_at() RETURNS trigger AS $$
BEGIN
  IF NEW.cycle_id IS NULL THEN
    NEW.cycle_added_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.cycle_added_at := coalesce(NEW.cycle_added_at, now());
  ELSIF OLD.cycle_id IS DISTINCT FROM NEW.cycle_id THEN
    NEW.cycle_added_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER issues_cycle_added_at
  BEFORE INSERT OR UPDATE ON issues
  FOR EACH ROW EXECUTE FUNCTION issues_cycle_added_at();
