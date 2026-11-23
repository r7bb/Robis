ALTER TYPE "public"."actor_kind" ADD VALUE 'rule';--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"trigger" text NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rules_trigger" CHECK ("automation_rules"."trigger" in ('issue.created', 'issue.status_changed', 'issue.label_added'))
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rule_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_runs_outcome" CHECK ("automation_runs"."outcome" in ('applied', 'unmatched', 'own_change', 'stopped', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_rules_workspace_trigger_idx" ON "automation_rules" USING btree ("workspace_id","trigger") WHERE "automation_rules"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_rule_event_key" ON "automation_runs" USING btree ("rule_id","event_id");--> statement-breakpoint
CREATE INDEX "automation_runs_rule_at_idx" ON "automation_runs" USING btree ("rule_id","at");