CREATE TYPE "public"."avatar_kind" AS ENUM('photo', 'generated');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_kind" "avatar_kind";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_ref" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_updated_at" timestamp with time zone;