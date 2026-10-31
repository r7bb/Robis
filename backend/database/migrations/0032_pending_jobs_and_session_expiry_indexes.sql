DROP INDEX "jobs_claim_idx";--> statement-breakpoint
CREATE INDEX "jobs_pending_run_at_idx" ON "jobs" USING btree ("run_at") WHERE "jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");