CREATE TYPE "public"."agent_change_outcome" AS ENUM('kept', 'edited', 'reverted');--> statement-breakpoint
CREATE TYPE "public"."agent_step_outcome" AS ENUM('ok', 'denied', 'error');--> statement-breakpoint
CREATE TYPE "public"."suggestion_action" AS ENUM('accepted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."suggestion_kind" AS ENUM('duplicate', 'priority');--> statement-breakpoint
CREATE TABLE "agent_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"before" text,
	"after" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" "agent_change_outcome",
	"judged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"source" text NOT NULL,
	"run_key" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_step_at" timestamp with time zone DEFAULT now() NOT NULL,
	"steps" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"outcome" "agent_step_outcome" NOT NULL,
	"status" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestion_feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "suggestion_kind" NOT NULL,
	"action" "suggestion_action" NOT NULL,
	"score" double precision,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_changes" ADD CONSTRAINT "agent_changes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_changes" ADD CONSTRAINT "agent_changes_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_feedback" ADD CONSTRAINT "suggestion_feedback_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_changes_workspace_agent_idx" ON "agent_changes" USING btree ("workspace_id","agent_id");--> statement-breakpoint
CREATE INDEX "agent_changes_unjudged_idx" ON "agent_changes" USING btree ("at") WHERE "agent_changes"."judged_at" is null;--> statement-breakpoint
CREATE INDEX "agent_runs_workspace_started_idx" ON "agent_runs" USING btree ("workspace_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_last_step_idx" ON "agent_runs" USING btree ("agent_id","last_step_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_agent_run_key_key" ON "agent_runs" USING btree ("agent_id","run_key");--> statement-breakpoint
CREATE INDEX "agent_steps_run_idx" ON "agent_steps" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "agent_steps_workspace_at_idx" ON "agent_steps" USING btree ("workspace_id","at");--> statement-breakpoint
CREATE INDEX "suggestion_feedback_workspace_kind_idx" ON "suggestion_feedback" USING btree ("workspace_id","kind");