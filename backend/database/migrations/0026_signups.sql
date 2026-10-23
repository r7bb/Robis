CREATE TABLE "signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "signups_email_key" ON "signups" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "signups_token_hash_key" ON "signups" USING btree ("token_hash");