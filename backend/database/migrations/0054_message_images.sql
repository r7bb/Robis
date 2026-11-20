ALTER TABLE "messages" ADD COLUMN "image_key" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "image_content_type" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "image_bytes" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "image_width" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "image_height" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_image_key_key" ON "messages" USING btree ("image_key");