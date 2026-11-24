CREATE TABLE "recurring_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'NONE' NOT NULL,
	"assignee_id" uuid,
	"cadence" text NOT NULL,
	"weekday" integer,
	"month_day" integer,
	"hour" integer NOT NULL,
	"time_zone" text NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"paused" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_issues_hour" CHECK ("recurring_issues"."hour" between 0 and 23),
	CONSTRAINT "recurring_issues_weekday" CHECK ("recurring_issues"."weekday" is null or "recurring_issues"."weekday" between 0 and 6),
	CONSTRAINT "recurring_issues_month_day" CHECK ("recurring_issues"."month_day" is null or "recurring_issues"."month_day" between 1 and 28)
);
--> statement-breakpoint
ALTER TABLE "recurring_issues" ADD CONSTRAINT "recurring_issues_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_issues" ADD CONSTRAINT "recurring_issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_issues" ADD CONSTRAINT "recurring_issues_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_issues" ADD CONSTRAINT "recurring_issues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_issues_due_idx" ON "recurring_issues" USING btree ("next_run_at") WHERE "recurring_issues"."paused" = false;--> statement-breakpoint
CREATE INDEX "recurring_issues_project_idx" ON "recurring_issues" USING btree ("project_id");