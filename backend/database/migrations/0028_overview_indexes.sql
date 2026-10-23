CREATE INDEX "comments_workspace_created_idx" ON "comments" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "issues_workspace_created_idx" ON "issues" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "issues_workspace_updated_idx" ON "issues" USING btree ("workspace_id","updated_at");