DROP INDEX "auth_tokens_user_purpose_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_user_purpose_key" ON "auth_tokens" USING btree ("user_id","purpose");