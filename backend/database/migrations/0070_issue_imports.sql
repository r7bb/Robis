CREATE TABLE "issue_imports" (
	"project_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_imports_project_id_source_key_pk" PRIMARY KEY("project_id","source_key")
);
--> statement-breakpoint
ALTER TABLE "issue_imports" ADD CONSTRAINT "issue_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_imports" ADD CONSTRAINT "issue_imports_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_imports" ADD CONSTRAINT "issue_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;