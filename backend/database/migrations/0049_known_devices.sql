ALTER TYPE "public"."auth_token_purpose" ADD VALUE 'not_me';--> statement-breakpoint
CREATE TABLE "known_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_hash" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "known_devices_user_device_key" ON "known_devices" USING btree ("user_id","device_hash");--> statement-breakpoint
CREATE INDEX "known_devices_last_seen_idx" ON "known_devices" USING btree ("last_seen_at");