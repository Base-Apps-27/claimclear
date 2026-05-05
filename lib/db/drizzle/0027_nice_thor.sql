ALTER TABLE "invoice_groups" ADD COLUMN "is_tour_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "is_tour_sample" boolean DEFAULT false NOT NULL;