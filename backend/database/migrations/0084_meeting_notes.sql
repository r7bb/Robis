ALTER TABLE "meetings" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "notes_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "notes_updated_by" uuid;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_notes_updated_by_users_id_fk" FOREIGN KEY ("notes_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;