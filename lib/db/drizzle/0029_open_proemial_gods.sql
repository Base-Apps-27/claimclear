DROP INDEX "invoice_groups_invoice_number_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_groups_invoice_number_unique" ON "invoice_groups" USING btree ("invoice_number");