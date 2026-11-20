CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"tone" text,
	"storage_key" text,
	"content_type" text,
	"bytes" integer,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "stories_kind_fields" CHECK (("stories"."kind" = 'photo' and "stories"."storage_key" is not null and "stories"."body" is null) or ("stories"."kind" = 'text' and "stories"."storage_key" is null and "stories"."body" is not null))
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "stories_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stories_storage_key_key" ON "stories" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "stories_workspace_expires_idx" ON "stories" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE INDEX "stories_author_idx" ON "stories" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "stories_expires_idx" ON "stories" USING btree ("expires_at");