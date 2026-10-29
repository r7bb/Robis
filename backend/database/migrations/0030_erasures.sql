CREATE TABLE "erasures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"commitment" text NOT NULL,
	"audit_events_erased" integer NOT NULL,
	"usernames_forgotten" integer NOT NULL
);
