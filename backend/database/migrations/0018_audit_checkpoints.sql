CREATE TABLE "audit_checkpoints" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"seq" bigint NOT NULL,
	"hash" text NOT NULL,
	"signed" boolean NOT NULL,
	"key_id" text NOT NULL,
	"mac" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_checkpoints" ADD CONSTRAINT "audit_checkpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;