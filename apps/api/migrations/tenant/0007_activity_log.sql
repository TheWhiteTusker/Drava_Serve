CREATE TABLE "activity" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"outlet_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_outlet_id_at_index" ON "activity" USING btree ("outlet_id","at");--> statement-breakpoint
CREATE INDEX "activity_kind_index" ON "activity" USING btree ("kind");--> statement-breakpoint
CREATE TRIGGER activity_append_only BEFORE UPDATE OR DELETE ON activity FOR EACH ROW EXECUTE FUNCTION reject_change();
