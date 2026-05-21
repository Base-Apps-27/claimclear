CREATE TABLE "sop_library_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_type_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"error_type_id" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"tree_node_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"comment" text
);
--> statement-breakpoint
ALTER TABLE "error_types" ADD COLUMN "source_sop_text" text;--> statement-breakpoint
ALTER TABLE "error_type_versions" ADD CONSTRAINT "error_type_versions_error_type_id_error_types_id_fk" FOREIGN KEY ("error_type_id") REFERENCES "public"."error_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "error_type_versions_error_type_id_created_at_idx" ON "error_type_versions" USING btree ("error_type_id","created_at" DESC NULLS LAST);