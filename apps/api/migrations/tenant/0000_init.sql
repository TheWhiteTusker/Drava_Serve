CREATE TABLE "active_discount" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"price_rule_id" uuid NOT NULL,
	"trigger_menu_item_id" uuid NOT NULL,
	"discount_pct" numeric(5, 2) NOT NULL,
	"menu_price" numeric(12, 2) NOT NULL,
	"offer_price" numeric(12, 2) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"login" text NOT NULL,
	"phone" text,
	"password_hash" text,
	"pin_hash" text,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_login_unique" UNIQUE("login")
);
--> statement-breakpoint
CREATE TABLE "approval_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid,
	"type" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"current" jsonb,
	"proposed" jsonb NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"proposed_by" uuid NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"purpose" text,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"taken_by" uuid,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"device_id" text,
	"outlet_id" uuid,
	"entity" text NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "bill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"number" text,
	"client_id" uuid,
	"kind" text NOT NULL,
	"table_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"business_date" date NOT NULL,
	"opened_by" uuid NOT NULL,
	"closed_by" uuid,
	"device_id" text,
	"food_subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"food_tax" numeric(12, 2) DEFAULT '0' NOT NULL,
	"liquor_subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"liquor_tax" numeric(12, 2) DEFAULT '0' NOT NULL,
	"taxes" jsonb,
	"manual_discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"round_off" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cancel_reason" text,
	"approval_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_clientId_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "bill_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"client_id" uuid,
	"placed_at" timestamp with time zone NOT NULL,
	"placed_by" uuid NOT NULL,
	CONSTRAINT "bill_order_clientId_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "brand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_kind_parentId_name_unique" UNIQUE NULLS NOT DISTINCT("kind","parent_id","name"),
	CONSTRAINT "category_kind" CHECK ("category"."kind" in ('course','liquor_type','liquor_subtype','stock'))
);
--> statement-breakpoint
CREATE TABLE "day_close" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"closed_by" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"totals" jsonb NOT NULL,
	"cash_counted" numeric(12, 2),
	"notes" text,
	CONSTRAINT "day_close_outletId_businessDate_unique" UNIQUE("outlet_id","business_date")
);
--> statement-breakpoint
CREATE TABLE "delivery_send" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"indent_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"result" text NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "dining_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dining_table_outletId_name_unique" UNIQUE("outlet_id","name")
);
--> statement-breakpoint
CREATE TABLE "goods_received_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"receipt_check_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text NOT NULL,
	"watchman_confirmed_by" uuid,
	"watchman_confirmed_at" timestamp with time zone,
	"staff_confirmed_by" uuid,
	"staff_confirmed_at" timestamp with time zone,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"amount_gross" numeric(12, 2) DEFAULT '0' NOT NULL,
	"return_deduction" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_payable" numeric(12, 2) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_received_note_receiptCheckId_unique" UNIQUE("receipt_check_id")
);
--> statement-breakpoint
CREATE TABLE "grn_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grn_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"unit_id" uuid,
	"accepted_qty" numeric(14, 3) NOT NULL,
	"accepted_base_qty" numeric(14, 3) NOT NULL,
	"billed_rate" numeric(12, 2) NOT NULL,
	"rate_per_base" numeric(16, 6) NOT NULL,
	"last_rate_per_base" numeric(16, 6),
	"amount" numeric(12, 2) NOT NULL,
	"expires_on" date
);
--> statement-breakpoint
CREATE TABLE "indent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"for_date" date NOT NULL,
	"status" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"pdf_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indent_outletId_vendorId_forDate_unique" UNIQUE("outlet_id","vendor_id","for_date")
);
--> statement-breakpoint
CREATE TABLE "indent_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"indent_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"unit_id" uuid,
	"par_qty" numeric(14, 3) NOT NULL,
	"on_hand_qty" numeric(14, 3) NOT NULL,
	"on_order_qty" numeric(14, 3) NOT NULL,
	"suggested_qty" numeric(14, 3) NOT NULL,
	"approved_qty" numeric(14, 3),
	"last_rate" numeric(12, 2)
);
--> statement-breakpoint
CREATE TABLE "margin_target" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"category_id" uuid,
	"target_pct" numeric(5, 2) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "margin_target_outletId_categoryId_unique" UNIQUE NULLS NOT DISTINCT("outlet_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "menu_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"department" text NOT NULL,
	"category_id" uuid NOT NULL,
	"brand_id" uuid,
	"diet_type" text,
	"serve_size_ml" numeric(14, 3),
	"selling_price" numeric(12, 2) NOT NULL,
	"tax_class_id" uuid NOT NULL,
	"target_margin_pct" numeric(5, 2),
	"low_threshold" integer,
	"calories" integer,
	"description" text,
	"photo_key" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"allergens" text[] DEFAULT '{}'::text[] NOT NULL,
	"pin_position" integer,
	"offer_excluded" boolean DEFAULT false NOT NULL,
	"recipe_version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_item_outletId_name_unique" UNIQUE("outlet_id","name"),
	CONSTRAINT "menu_item_diet" CHECK ("menu_item"."department" <> 'food' or "menu_item"."diet_type" in ('veg','non_veg','egg')),
	CONSTRAINT "menu_item_price" CHECK ("menu_item"."selling_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "menu_item_cost" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"portion_cost" numeric(16, 6) NOT NULL,
	"selling_price" numeric(12, 2) NOT NULL,
	"margin_amount" numeric(16, 6) NOT NULL,
	"margin_pct" numeric(7, 2) NOT NULL,
	"reason" text,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_rank" (
	"menu_item_id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"available_portions" numeric(14, 3),
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"department" text NOT NULL,
	"tax_class_id" uuid NOT NULL,
	"tax_kind" text NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"menu_price" numeric(12, 2) NOT NULL,
	"price_charged" numeric(12, 2) NOT NULL,
	"active_discount_id" uuid,
	"cost_at_sale" numeric(16, 6),
	"status" text DEFAULT 'active' NOT NULL,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"state" text NOT NULL,
	"address" text,
	"gstin" text,
	"fssai_number" text,
	"excise_licence" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outlet_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"client_id" uuid,
	"mode" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reference" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid NOT NULL,
	CONSTRAINT "payment_clientId_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "price_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"trigger_serves" integer DEFAULT 5 NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '10' NOT NULL,
	"band_min_pct" numeric(5, 2) DEFAULT '1' NOT NULL,
	"band_max_pct" numeric(5, 2) DEFAULT '25' NOT NULL,
	"match_scope" text DEFAULT 'type_and_serve' NOT NULL,
	"margin_floor_pct" numeric(5, 2) DEFAULT '55' NOT NULL,
	"min_substitute_serves" integer DEFAULT 15 NOT NULL,
	"max_items" integer DEFAULT 3 NOT NULL,
	"release_buffer_serves" integer DEFAULT 3 NOT NULL,
	"mode" text DEFAULT 'auto' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"indent_id" uuid,
	"vendor_id" uuid NOT NULL,
	"expected_on" date NOT NULL,
	"status" text DEFAULT 'expected' NOT NULL,
	"gate_by" uuid,
	"gate_at" timestamp with time zone,
	"recheck_by" uuid,
	"recheck_at" timestamp with time zone,
	"vendor_bill_no" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_check_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_check_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"unit_id" uuid,
	"ordered_qty" numeric(14, 3) NOT NULL,
	"gate_status" text DEFAULT 'pending' NOT NULL,
	"gate_qty" numeric(14, 3),
	"gate_reason" text,
	"recheck_accepted_qty" numeric(14, 3),
	"recheck_rejected_qty" numeric(14, 3),
	"recheck_reason" text,
	"measured_qty" numeric(14, 3),
	"billed_rate" numeric(12, 2),
	"expires_on" date
);
--> statement-breakpoint
CREATE TABLE "recipe_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"yield_pct" numeric(5, 2) DEFAULT '100' NOT NULL,
	CONSTRAINT "recipe_line_menuItemId_stockItemId_unique" UNIQUE("menu_item_id","stock_item_id"),
	CONSTRAINT "recipe_qty_positive" CHECK ("recipe_line"."quantity" > 0),
	CONSTRAINT "recipe_yield" CHECK ("recipe_line"."yield_pct" > 0 and "recipe_line"."yield_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "return_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"receipt_check_id" uuid NOT NULL,
	"grn_id" uuid,
	"vendor_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"reason" text NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "role_permission" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permission_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "sales_daily" (
	"outlet_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"department" text NOT NULL,
	"bills" integer DEFAULT 0 NOT NULL,
	"revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"alcohol_ml" numeric(14, 3) DEFAULT '0' NOT NULL,
	CONSTRAINT "sales_daily_outlet_id_business_date_department_pk" PRIMARY KEY("outlet_id","business_date","department")
);
--> statement-breakpoint
CREATE TABLE "sales_hourly" (
	"outlet_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"hour" smallint NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"units" numeric(14, 3) DEFAULT '0' NOT NULL,
	"revenue" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "sales_hourly_outlet_id_business_date_hour_menu_item_id_pk" PRIMARY KEY("outlet_id","business_date","hour","menu_item_id")
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setting_outletId_key_unique" UNIQUE NULLS NOT DISTINCT("outlet_id","key")
);
--> statement-breakpoint
CREATE TABLE "stock_balance" (
	"store_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(16, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balance_store_id_stock_item_id_pk" PRIMARY KEY("store_id","stock_item_id")
);
--> statement-breakpoint
CREATE TABLE "stock_count" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"scheduled_for" date NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approval_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_count_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"expected_qty" numeric(14, 3) NOT NULL,
	"counted_qty" numeric(14, 3),
	"cause" text,
	CONSTRAINT "stock_count_line_countId_stockItemId_unique" UNIQUE("count_id","stock_item_id")
);
--> statement-breakpoint
CREATE TABLE "stock_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"department" text NOT NULL,
	"category_id" uuid,
	"brand_id" uuid,
	"base_unit" text NOT NULL,
	"bottle_size_ml" numeric(14, 3),
	"abv_pct" numeric(5, 2),
	"origin" text,
	"price_tier" text,
	"perishable" boolean DEFAULT false NOT NULL,
	"shelf_life_days" integer,
	"current_cost" numeric(16, 6) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_item_name_unique" UNIQUE("name"),
	CONSTRAINT "stock_item_department" CHECK ("stock_item"."department" in ('food','beverage')),
	CONSTRAINT "stock_item_base_unit" CHECK ("stock_item"."base_unit" in ('g','ml','pc'))
);
--> statement-breakpoint
CREATE TABLE "stock_item_unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"factor" numeric(14, 3) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "stock_item_unit_stockItemId_name_unique" UNIQUE("stock_item_id","name"),
	CONSTRAINT "unit_factor_positive" CHECK ("stock_item_unit"."factor" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"lot_id" uuid,
	"qty" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(16, 6) NOT NULL,
	"movement" text NOT NULL,
	"reason" text,
	"ref_type" text,
	"ref_id" text,
	"reverses_id" bigint,
	"approval_id" uuid,
	"user_id" uuid,
	"device_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_level" (
	"stock_item_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"par_level" numeric(14, 3) DEFAULT '0' NOT NULL,
	"reorder_level" numeric(14, 3) DEFAULT '0' NOT NULL,
	"critical_level" numeric(14, 3) DEFAULT '0' NOT NULL,
	CONSTRAINT "stock_level_stock_item_id_outlet_id_pk" PRIMARY KEY("stock_item_id","outlet_id")
);
--> statement-breakpoint
CREATE TABLE "stock_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"expires_on" date,
	"grn_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"from_store_id" uuid NOT NULL,
	"to_store_id" uuid NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_outletId_name_unique" UNIQUE("outlet_id","name")
);
--> statement-breakpoint
CREATE TABLE "tax_class" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"components" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_class_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"outlet_id" uuid,
	CONSTRAINT "user_role_userId_roleId_outletId_unique" UNIQUE NULLS NOT DISTINCT("user_id","role_id","outlet_id")
);
--> statement-breakpoint
CREATE TABLE "vendor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"department" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"gstin" text,
	"address" text,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "vendor_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"unit_id" uuid,
	"pack_size" numeric(14, 3) DEFAULT '1' NOT NULL,
	"preferred" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vendor_item_vendorId_stockItemId_unique" UNIQUE("vendor_id","stock_item_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grn_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"mode" text NOT NULL,
	"reference" text,
	"amount" numeric(12, 2) NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"unit_id" uuid,
	"rate" numeric(12, 2) NOT NULL,
	"rate_per_base" numeric(16, 6) NOT NULL,
	"billed_on" date NOT NULL,
	"grn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "active_discount" ADD CONSTRAINT "active_discount_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_discount" ADD CONSTRAINT "active_discount_menu_item_id_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_discount" ADD CONSTRAINT "active_discount_price_rule_id_price_rule_id_fk" FOREIGN KEY ("price_rule_id") REFERENCES "public"."price_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_discount" ADD CONSTRAINT "active_discount_trigger_menu_item_id_menu_item_id_fk" FOREIGN KEY ("trigger_menu_item_id") REFERENCES "public"."menu_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_proposed_by_app_user_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_taken_by_app_user_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_table_id_dining_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dining_table"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_opened_by_app_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_closed_by_app_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill" ADD CONSTRAINT "bill_approval_id_approval_request_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_order" ADD CONSTRAINT "bill_order_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_order" ADD CONSTRAINT "bill_order_placed_by_app_user_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_close" ADD CONSTRAINT "day_close_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_close" ADD CONSTRAINT "day_close_closed_by_app_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_send" ADD CONSTRAINT "delivery_send_indent_id_indent_id_fk" FOREIGN KEY ("indent_id") REFERENCES "public"."indent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_send" ADD CONSTRAINT "delivery_send_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_table" ADD CONSTRAINT "dining_table_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_received_note" ADD CONSTRAINT "goods_received_note_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_received_note" ADD CONSTRAINT "goods_received_note_receipt_check_id_receipt_check_id_fk" FOREIGN KEY ("receipt_check_id") REFERENCES "public"."receipt_check"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_received_note" ADD CONSTRAINT "goods_received_note_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_received_note" ADD CONSTRAINT "goods_received_note_watchman_confirmed_by_app_user_id_fk" FOREIGN KEY ("watchman_confirmed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_received_note" ADD CONSTRAINT "goods_received_note_staff_confirmed_by_app_user_id_fk" FOREIGN KEY ("staff_confirmed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_received_note" ADD CONSTRAINT "goods_received_note_released_by_app_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_line" ADD CONSTRAINT "grn_line_grn_id_goods_received_note_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_received_note"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_line" ADD CONSTRAINT "grn_line_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_line" ADD CONSTRAINT "grn_line_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_line" ADD CONSTRAINT "grn_line_unit_id_stock_item_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."stock_item_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indent" ADD CONSTRAINT "indent_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indent" ADD CONSTRAINT "indent_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indent" ADD CONSTRAINT "indent_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indent_line" ADD CONSTRAINT "indent_line_indent_id_indent_id_fk" FOREIGN KEY ("indent_id") REFERENCES "public"."indent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indent_line" ADD CONSTRAINT "indent_line_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indent_line" ADD CONSTRAINT "indent_line_unit_id_stock_item_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."stock_item_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "margin_target" ADD CONSTRAINT "margin_target_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "margin_target" ADD CONSTRAINT "margin_target_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item" ADD CONSTRAINT "menu_item_tax_class_id_tax_class_id_fk" FOREIGN KEY ("tax_class_id") REFERENCES "public"."tax_class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_cost" ADD CONSTRAINT "menu_item_cost_menu_item_id_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_rank" ADD CONSTRAINT "menu_rank_menu_item_id_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_rank" ADD CONSTRAINT "menu_rank_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_bill_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bill_order"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_menu_item_id_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_tax_class_id_tax_class_id_fk" FOREIGN KEY ("tax_class_id") REFERENCES "public"."tax_class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_active_discount_id_active_discount_id_fk" FOREIGN KEY ("active_discount_id") REFERENCES "public"."active_discount"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_bill_id_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_received_by_app_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rule" ADD CONSTRAINT "price_rule_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_check" ADD CONSTRAINT "receipt_check_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_check" ADD CONSTRAINT "receipt_check_indent_id_indent_id_fk" FOREIGN KEY ("indent_id") REFERENCES "public"."indent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_check" ADD CONSTRAINT "receipt_check_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_check" ADD CONSTRAINT "receipt_check_gate_by_app_user_id_fk" FOREIGN KEY ("gate_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_check" ADD CONSTRAINT "receipt_check_recheck_by_app_user_id_fk" FOREIGN KEY ("recheck_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_check_line" ADD CONSTRAINT "receipt_check_line_receipt_check_id_receipt_check_id_fk" FOREIGN KEY ("receipt_check_id") REFERENCES "public"."receipt_check"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_check_line" ADD CONSTRAINT "receipt_check_line_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_check_line" ADD CONSTRAINT "receipt_check_line_unit_id_stock_item_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."stock_item_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_menu_item_id_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_note" ADD CONSTRAINT "return_note_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_note" ADD CONSTRAINT "return_note_receipt_check_id_receipt_check_id_fk" FOREIGN KEY ("receipt_check_id") REFERENCES "public"."receipt_check"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_note" ADD CONSTRAINT "return_note_grn_id_goods_received_note_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_received_note"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_note" ADD CONSTRAINT "return_note_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_note" ADD CONSTRAINT "return_note_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_note" ADD CONSTRAINT "return_note_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_daily" ADD CONSTRAINT "sales_daily_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_hourly" ADD CONSTRAINT "sales_hourly_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_hourly" ADD CONSTRAINT "sales_hourly_menu_item_id_menu_item_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting" ADD CONSTRAINT "setting_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_submitted_by_app_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count" ADD CONSTRAINT "stock_count_approval_id_approval_request_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_count_id_stock_count_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_count"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_line" ADD CONSTRAINT "stock_count_line_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item" ADD CONSTRAINT "stock_item_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_item_unit" ADD CONSTRAINT "stock_item_unit_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_lot_id_stock_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_approval_id_approval_request_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot" ADD CONSTRAINT "stock_lot_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot" ADD CONSTRAINT "stock_lot_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_store_id_store_id_fk" FOREIGN KEY ("from_store_id") REFERENCES "public"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_to_store_id_store_id_fk" FOREIGN KEY ("to_store_id") REFERENCES "public"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store" ADD CONSTRAINT "store_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_outlet_id_outlet_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_item" ADD CONSTRAINT "vendor_item_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_item" ADD CONSTRAINT "vendor_item_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_item" ADD CONSTRAINT "vendor_item_unit_id_stock_item_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."stock_item_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payment" ADD CONSTRAINT "vendor_payment_grn_id_goods_received_note_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."goods_received_note"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_payment" ADD CONSTRAINT "vendor_payment_recorded_by_app_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate" ADD CONSTRAINT "vendor_rate_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate" ADD CONSTRAINT "vendor_rate_stock_item_id_stock_item_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_rate" ADD CONSTRAINT "vendor_rate_unit_id_stock_item_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."stock_item_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "active_discount_outlet_id_status_index" ON "active_discount" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "approval_request_status_outlet_id_index" ON "approval_request" USING btree ("status","outlet_id");--> statement-breakpoint
CREATE INDEX "attachment_entity_entity_id_index" ON "attachment" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_entity_id_index" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_index" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "bill_outlet_id_business_date_index" ON "bill" USING btree ("outlet_id","business_date");--> statement-breakpoint
CREATE INDEX "bill_outlet_id_status_index" ON "bill" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "menu_item_outlet_id_category_id_index" ON "menu_item" USING btree ("outlet_id","category_id");--> statement-breakpoint
CREATE INDEX "menu_item_cost_menu_item_id_calculated_at_index" ON "menu_item_cost" USING btree ("menu_item_id","calculated_at");--> statement-breakpoint
CREATE INDEX "order_line_bill_id_index" ON "order_line" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "order_line_menu_item_id_created_at_index" ON "order_line" USING btree ("menu_item_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_ledger_store_id_stock_item_id_at_index" ON "stock_ledger" USING btree ("store_id","stock_item_id","at");--> statement-breakpoint
CREATE INDEX "stock_ledger_ref_type_ref_id_index" ON "stock_ledger" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "stock_ledger_outlet_id_at_index" ON "stock_ledger" USING btree ("outlet_id","at");--> statement-breakpoint
CREATE INDEX "vendor_rate_stock_item_id_billed_on_index" ON "vendor_rate" USING btree ("stock_item_id","billed_on");