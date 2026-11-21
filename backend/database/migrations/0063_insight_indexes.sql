-- IF NOT EXISTS so a large install can build both first with CREATE INDEX
-- CONCURRENTLY (same names and predicates), leaving this a no-op instead of
-- holding writes to audit_events while it builds. See docs/DEPLOY.md.
CREATE INDEX IF NOT EXISTS "audit_events_status_moves_idx" ON "audit_events" USING btree ("workspace_id","entity_id","seq") WHERE "audit_events"."event_type" = 'issue.status_changed';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issues_workspace_completed_idx" ON "issues" USING btree ("workspace_id","completed_at") WHERE "issues"."status" = 'DONE';