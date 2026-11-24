ALTER TABLE "meetings" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(agenda, '')), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "space_replies" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(body, ''))) STORED;--> statement-breakpoint
ALTER TABLE "space_threads" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(body, '')), 'B')) STORED;--> statement-breakpoint
CREATE INDEX "meetings_search_idx" ON "meetings" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "space_replies_search_idx" ON "space_replies" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "space_threads_search_idx" ON "space_threads" USING gin ("search_vector");