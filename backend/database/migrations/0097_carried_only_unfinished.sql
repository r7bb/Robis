-- As 0096, with carry-over counted only when the issue is unfinished both
-- before and after the move, so one edit that finishes an issue and moves it
-- to another cycle is not counted as carried.
CREATE OR REPLACE FUNCTION issues_cycle_added_at() RETURNS trigger AS $$
BEGIN
  IF NEW.cycle_id IS NULL THEN
    NEW.cycle_added_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.cycle_added_at := coalesce(NEW.cycle_added_at, now());
  ELSIF OLD.cycle_id IS DISTINCT FROM NEW.cycle_id THEN
    NEW.cycle_added_at := now();
    IF OLD.cycle_id IS NOT NULL
      AND OLD.status NOT IN ('DONE', 'CANCELED')
      AND NEW.status NOT IN ('DONE', 'CANCELED') THEN
      NEW.carried_over := OLD.carried_over + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
