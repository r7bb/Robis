ALTER TABLE "cycles" ADD COLUMN "left_unfinished" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- An unfinished issue leaving a cycle, moved on to another or taken out,
-- adds one to that cycle, whichever write path moved it. Not when the cycle
-- itself is removed: that clears its issues through the foreign key, which
-- runs as a trigger, so this one is then a level deeper.
CREATE FUNCTION cycles_left_unfinished() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() = 1
    AND OLD.cycle_id IS NOT NULL
    AND OLD.cycle_id IS DISTINCT FROM NEW.cycle_id
    AND OLD.status NOT IN ('DONE', 'CANCELED') THEN
    UPDATE cycles SET left_unfinished = left_unfinished + 1 WHERE id = OLD.cycle_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER cycles_left_unfinished
  AFTER UPDATE OF cycle_id ON issues
  FOR EACH ROW EXECUTE FUNCTION cycles_left_unfinished();
