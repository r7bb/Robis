DROP INDEX "signups_email_key";--> statement-breakpoint
CREATE INDEX "signups_email_idx" ON "signups" USING btree ("email");