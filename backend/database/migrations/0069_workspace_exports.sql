CREATE TABLE "workspace_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"bytes" integer,
	"error" text,
	"link_hash" text,
	"link_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"downloaded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspace_exports" ADD CONSTRAINT "workspace_exports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_exports" ADD CONSTRAINT "workspace_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_exports_workspace_idx" ON "workspace_exports" USING btree ("workspace_id","created_at");