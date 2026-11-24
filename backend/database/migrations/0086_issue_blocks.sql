CREATE TABLE "issue_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "issue_blocks_not_self" CHECK ("issue_blocks"."blocker_id" <> "issue_blocks"."blocked_id")
);
--> statement-breakpoint
ALTER TABLE "issue_blocks" ADD CONSTRAINT "issue_blocks_blocker_id_issues_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_blocks" ADD CONSTRAINT "issue_blocks_blocked_id_issues_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_blocks" ADD CONSTRAINT "issue_blocks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_blocks" ADD CONSTRAINT "issue_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_blocks_blocked_idx" ON "issue_blocks" USING btree ("blocked_id");