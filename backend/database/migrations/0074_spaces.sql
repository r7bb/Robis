CREATE TABLE "celebration_reactions" (
	"workspace_id" uuid NOT NULL,
	"celebration_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "celebration_reactions_workspace_id_celebration_id_user_id_reaction_pk" PRIMARY KEY("workspace_id","celebration_id","user_id","reaction")
);
--> statement-breakpoint
CREATE TABLE "space_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_reply_reactions" (
	"reply_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_reply_reactions_reply_id_user_id_reaction_pk" PRIMARY KEY("reply_id","user_id","reaction")
);
--> statement-breakpoint
CREATE TABLE "space_thread_reactions" (
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_thread_reactions_thread_id_user_id_reaction_pk" PRIMARY KEY("thread_id","user_id","reaction")
);
--> statement-breakpoint
CREATE TABLE "space_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"solved_reply_id" uuid,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "celebration_reactions" ADD CONSTRAINT "celebration_reactions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebration_reactions" ADD CONSTRAINT "celebration_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_replies" ADD CONSTRAINT "space_replies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_replies" ADD CONSTRAINT "space_replies_thread_id_space_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."space_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_replies" ADD CONSTRAINT "space_replies_parent_id_space_replies_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."space_replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_replies" ADD CONSTRAINT "space_replies_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_reply_reactions" ADD CONSTRAINT "space_reply_reactions_reply_id_space_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."space_replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_reply_reactions" ADD CONSTRAINT "space_reply_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_thread_reactions" ADD CONSTRAINT "space_thread_reactions_thread_id_space_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."space_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_thread_reactions" ADD CONSTRAINT "space_thread_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_threads" ADD CONSTRAINT "space_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_threads" ADD CONSTRAINT "space_threads_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_threads" ADD CONSTRAINT "space_threads_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_threads" ADD CONSTRAINT "space_threads_solved_reply_id_space_replies_id_fk" FOREIGN KEY ("solved_reply_id") REFERENCES "public"."space_replies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_replies_thread_created_idx" ON "space_replies" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "space_replies_author_idx" ON "space_replies" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "space_reply_reactions_created_idx" ON "space_reply_reactions" USING btree ("reaction","created_at");--> statement-breakpoint
CREATE INDEX "space_threads_space_activity_idx" ON "space_threads" USING btree ("space_id","last_activity_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "space_threads_workspace_created_idx" ON "space_threads" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "spaces_workspace_name_key" ON "spaces" USING btree ("workspace_id",lower("name"));