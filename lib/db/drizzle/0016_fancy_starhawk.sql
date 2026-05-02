ALTER TABLE "claims" ADD COLUMN "duplicate_of_claim_id" integer;--> statement-breakpoint
ALTER TABLE "error_types" ADD COLUMN "trip_overriding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_duplicate_of_claim_id_claims_id_fk" FOREIGN KEY ("duplicate_of_claim_id") REFERENCES "public"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_claims_duplicate_of_claim_id" ON "claims" USING btree ("duplicate_of_claim_id") WHERE "claims"."duplicate_of_claim_id" IS NOT NULL;