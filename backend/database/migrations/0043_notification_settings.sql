CREATE TABLE "notification_settings" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_user_id_kind_channel_pk" PRIMARY KEY("user_id","kind","channel"),
	CONSTRAINT "notification_settings_kind" CHECK ("notification_settings"."kind" in ('mention', 'assignment', 'issue_comment', 'meeting', 'nudge')),
	CONSTRAINT "notification_settings_channel" CHECK ("notification_settings"."channel" in ('in_app', 'email', 'push'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "in_app" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;