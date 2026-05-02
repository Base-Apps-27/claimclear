ALTER TABLE "invoice_groups" ADD COLUMN "service_date" date;--> statement-breakpoint
CREATE INDEX "invoice_groups_service_date_idx" ON "invoice_groups" USING btree ("service_date");