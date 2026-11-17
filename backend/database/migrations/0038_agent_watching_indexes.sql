DROP INDEX "agent_runs_agent_last_step_idx";--> statement-breakpoint
DROP INDEX "agent_runs_agent_run_key_key";--> statement-breakpoint
DROP INDEX "suggestion_feedback_workspace_kind_idx";--> statement-breakpoint
CREATE INDEX "agent_changes_agent_idx" ON "agent_changes" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_runs_open_idx" ON "agent_runs" USING btree ("agent_id","workspace_id","last_step_at") WHERE "agent_runs"."run_key" is null;--> statement-breakpoint
CREATE INDEX "agent_runs_last_step_idx" ON "agent_runs" USING btree ("last_step_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_agent_workspace_run_key_key" ON "agent_runs" USING btree ("agent_id","workspace_id","run_key");--> statement-breakpoint
CREATE INDEX "suggestion_feedback_counts_idx" ON "suggestion_feedback" USING btree ("workspace_id","kind","action");--> statement-breakpoint
ALTER TABLE "agent_runs" DROP COLUMN "steps";--> statement-breakpoint
ALTER TABLE "agent_changes" ADD CONSTRAINT "agent_changes_judged_whole" CHECK (("agent_changes"."outcome" is null) = ("agent_changes"."judged_at" is null));