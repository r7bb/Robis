DROP INDEX "workspace_invitations_workspace_user_key";--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD COLUMN "email" text;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_workspace_email_key" ON "workspace_invitations" USING btree ("workspace_id","email") WHERE "workspace_invitations"."email" is not null;--> statement-breakpoint
CREATE INDEX "workspace_invitations_email_idx" ON "workspace_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "workspace_invitations_invited_by_idx" ON "workspace_invitations" USING btree ("invited_by");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_workspace_user_key" ON "workspace_invitations" USING btree ("workspace_id","user_id") WHERE "workspace_invitations"."user_id" is not null;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_one_addressee" CHECK (("workspace_invitations"."user_id" is null) <> ("workspace_invitations"."email" is null));