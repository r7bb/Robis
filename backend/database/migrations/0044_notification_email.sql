CREATE TABLE "email_digests" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"notification_ids" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_digests_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "unsubscribe_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kinds" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_due" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_digests" ADD CONSTRAINT "email_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unsubscribe_tokens" ADD CONSTRAINT "unsubscribe_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_digests_created_idx" ON "email_digests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "unsubscribe_tokens_expires_idx" ON "unsubscribe_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "notifications_digest_due_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."email_due" = 'digest' and "notifications"."emailed_at" is null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_email_due" CHECK ("notifications"."email_due" in ('now', 'digest'));