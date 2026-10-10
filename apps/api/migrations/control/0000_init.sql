CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"db_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_code_unique" UNIQUE("code"),
	CONSTRAINT "customer_dbName_unique" UNIQUE("db_name")
);
--> statement-breakpoint
CREATE TABLE "login_route" (
	"login" text PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_route" ADD CONSTRAINT "login_route_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;