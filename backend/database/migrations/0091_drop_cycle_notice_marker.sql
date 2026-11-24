DROP INDEX "cycles_ending_idx";--> statement-breakpoint
CREATE INDEX "cycles_ends_on_idx" ON "cycles" USING btree ("ends_on");--> statement-breakpoint
ALTER TABLE "cycles" DROP COLUMN "ending_noticed_at";