ALTER TABLE "category" DROP CONSTRAINT "category_kind";--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_kind" CHECK ("category"."kind" in ('course','liquor_type','liquor_subtype','drink_type','stock'));--> statement-breakpoint
-- Beverages are alcoholic (the liquor tree) or non-alcoholic (drink types). Existing customers get
-- the starting drink types here; a new customer's empty database gets them from bootstrap.
INSERT INTO "category" ("name", "kind", "sort_order")
SELECT v.name, 'drink_type', v.ord FROM (VALUES ('Soft drinks', 0), ('Juices and shakes', 1), ('Mocktails', 2), ('Tea and coffee', 3), ('Water', 4)) AS v(name, ord)
WHERE EXISTS (SELECT 1 FROM "category")
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Drinks filed under the old "Soft beverages" food course become non-alcoholic beverages.
UPDATE "menu_item" SET "department" = 'beverage', "version" = "version" + 1, "updated_at" = now(),
  "category_id" = (SELECT "id" FROM "category" WHERE "kind" = 'drink_type' AND "name" = 'Soft drinks')
WHERE "category_id" IN (SELECT "id" FROM "category" WHERE "kind" = 'course' AND "name" = 'Soft beverages');--> statement-breakpoint
UPDATE "category" SET "active" = false, "version" = "version" + 1, "updated_at" = now() WHERE "kind" = 'course' AND "name" = 'Soft beverages';
