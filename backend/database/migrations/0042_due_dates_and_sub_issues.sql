ALTER TABLE "issues" ADD COLUMN "due_on" date;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_parent_id_issues_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issues_parent_idx" ON "issues" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_parent_not_self" CHECK ("issues"."parent_id" <> "issues"."id");