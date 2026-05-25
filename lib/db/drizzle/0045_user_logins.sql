CREATE TABLE "user_logins" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"logged_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" varchar,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "user_logins" ADD CONSTRAINT "user_logins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_logins_user_id_logged_in_at_idx" ON "user_logins" USING btree ("user_id","logged_in_at");