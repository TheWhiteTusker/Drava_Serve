CREATE TABLE "bill_hourly" (
	"outlet_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"hour" smallint NOT NULL,
	"bills" integer DEFAULT 0 NOT NULL,
	"revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"minutes_spent" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bill_hourly_outlet_id_business_date_hour_pk" PRIMARY KEY("outlet_id","business_date","hour")
);
--> statement-breakpoint
ALTER TABLE "bill_hourly" ADD CONSTRAINT "bill_hourly_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;