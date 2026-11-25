ALTER TABLE "issues" ADD COLUMN "carried_over" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- As 0095, and counting carry-over: an unfinished issue moved straight from
-- one cycle to another (a rollover, or by hand) adds one. Leaving a cycle and
-- coming back later, or moving once finished, does not.
CREATE OR REPLACE FUNCTION issues_cycle_added_at() RETURNS trigger AS $$
BEGIN
  IF NEW.cycle_id IS NULL THEN
    NEW.cycle_added_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.cycle_added_at := coalesce(NEW.cycle_added_at, now());
  ELSIF OLD.cycle_id IS DISTINCT FROM NEW.cycle_id THEN
    NEW.cycle_added_at := now();
    IF OLD.cycle_id IS NOT NULL AND OLD.status NOT IN ('DONE', 'CANCELED') THEN
      NEW.carried_over := OLD.carried_over + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
