ALTER TABLE "users" ADD COLUMN "responsible_roles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "draft_attribution" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_groups" ADD COLUMN "closure_responsibility" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "closure_responsibility" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "portal_submissions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "portal_responses" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_logs_idempotency_key_uidx" ON "audit_logs" USING btree ("idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_submissions_idempotency_key_uidx" ON "portal_submissions" USING btree ("idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_responses_idempotency_key_uidx" ON "portal_responses" USING btree ("idempotency_key") WHERE idempotency_key IS NOT NULL;