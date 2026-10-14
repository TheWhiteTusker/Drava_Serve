-- Four characters from an alphabet without look-alikes (0/o, 1/l/i), for table QR links.
-- 31^4 ≈ 920,000 codes per outlet: readable on a printed card, not guessable from outside.
CREATE OR REPLACE FUNCTION table_code() RETURNS text AS $$
  SELECT string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '')
  FROM generate_series(1, 4)
$$ LANGUAGE sql VOLATILE;
--> statement-breakpoint
ALTER TABLE "dining_table" ADD COLUMN "code" text DEFAULT table_code() NOT NULL;--> statement-breakpoint
ALTER TABLE "dining_table" ADD CONSTRAINT "dining_table_outletId_code_unique" UNIQUE("outlet_id","code");
