CREATE TABLE IF NOT EXISTS "portal_batch_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"status" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"triggered_by" text NOT NULL,
	"triggered_by_email" text,
	"stopped_by" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "portal_batch_runs_batch_id_unique" UNIQUE("batch_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_batch_runs_started_at_idx" ON "portal_batch_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_batch_runs_triggered_by_email_idx" ON "portal_batch_runs" USING btree ("triggered_by_email");
