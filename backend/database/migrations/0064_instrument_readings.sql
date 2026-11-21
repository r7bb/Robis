-- Timings per instrument, process and minute (Phase 6). Unlogged, like the
-- rate counts: a crash forgets some minutes of a health chart, nothing else.
CREATE UNLOGGED TABLE "instrument_readings" (
	"instrument" text NOT NULL,
	"source" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"counts" integer[] NOT NULL,
	CONSTRAINT "instrument_readings_instrument_minute_source_pk" PRIMARY KEY("instrument","minute","source"),
	CONSTRAINT "instrument_readings_instrument" CHECK ("instrument_readings"."instrument" in ('sync_lag', 'fanout_latency')),
	CONSTRAINT "instrument_readings_buckets" CHECK (cardinality("instrument_readings"."counts") = 17)
);
