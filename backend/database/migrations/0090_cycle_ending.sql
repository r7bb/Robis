ALTER TABLE "notification_settings" DROP CONSTRAINT "notification_settings_kind";--> statement-breakpoint
ALTER TABLE "cycles" ADD COLUMN "time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "cycles" ADD COLUMN "ending_noticed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "cycles_ending_idx" ON "cycles" USING btree ("ends_on") WHERE "cycles"."ending_noticed_at" is null;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_kind" CHECK ("notification_settings"."kind" in ('mention', 'assignment', 'issue_comment', 'meeting', 'nudge', 'space_reply', 'space_answer', 'cycle_ending'));