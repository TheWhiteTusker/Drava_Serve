ALTER TABLE "order_line" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
-- Orders from before the kitchen screen count as served, so it opens with only today's open bills.
UPDATE "order_line" SET "ready_at" = "created_at" WHERE "bill_id" IN (SELECT "id" FROM "bill" WHERE "status" <> 'open');--> statement-breakpoint
-- Existing kitchen, bar, manager and owner roles get the kitchen screen; new customers get it from bootstrap.
INSERT INTO "role_permission" ("role_id", "permission")
SELECT "id", 'kitchen.view' FROM "role" WHERE "name" IN ('Owner / admin', 'Outlet manager', 'Storekeeper / kitchen staff', 'Chef / bar manager')
ON CONFLICT DO NOTHING;
