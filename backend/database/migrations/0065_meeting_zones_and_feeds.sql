CREATE TABLE "calendar_feeds" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "repeat_count" integer;--> statement-breakpoint
-- Existing meetings are one-offs: their last start is their start (B8).
ALTER TABLE "meetings" ADD COLUMN "last_starts_at" timestamp with time zone;--> statement-breakpoint
UPDATE "meetings" SET "last_starts_at" = "starts_at";--> statement-breakpoint
ALTER TABLE "meetings" ALTER COLUMN "last_starts_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meetings_workspace_last_starts_idx" ON "meetings" USING btree ("workspace_id","last_starts_at");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_repeat_count" CHECK ("meetings"."repeat_count" is null or "meetings"."repeat_count" between 2 and 52);