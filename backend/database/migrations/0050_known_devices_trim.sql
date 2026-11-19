CREATE INDEX "known_devices_device_hash_idx" ON "known_devices" USING btree ("device_hash");--> statement-breakpoint
ALTER TABLE "known_devices" DROP COLUMN "user_agent";