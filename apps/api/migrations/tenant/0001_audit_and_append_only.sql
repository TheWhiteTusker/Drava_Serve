-- Audit trail: every insert, update and delete on an audited table writes who, when, which
-- device, before and after. The API sets app.user_id / app.device_id at the start of each
-- transaction (set_config(..., true)), so the trigger sees them. Secrets are stripped.
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger AS $$
DECLARE
  old_j jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'password_hash' - 'pin_hash' END;
  new_j jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'password_hash' - 'pin_hash' END;
  row_j jsonb := coalesce(new_j, old_j);
BEGIN
  -- Skip no-op updates (only bookkeeping columns changed).
  IF TG_OP = 'UPDATE' AND (old_j - 'updated_at' - 'version' - 'failed_attempts' - 'locked_until')
                        = (new_j - 'updated_at' - 'version' - 'failed_attempts' - 'locked_until') THEN
    RETURN NEW;
  END IF;
  INSERT INTO audit_log (user_id, device_id, outlet_id, entity, entity_id, action, before, after)
  VALUES (
    nullif(current_setting('app.user_id', true), '')::uuid,
    nullif(current_setting('app.device_id', true), ''),
    CASE WHEN TG_TABLE_NAME = 'outlet' THEN (row_j->>'id')::uuid ELSE (row_j->>'outlet_id')::uuid END,
    TG_TABLE_NAME,
    coalesce(row_j->>'id', row_j->>'role_id', row_j->>'stock_item_id'),
    lower(TG_OP),
    old_j,
    new_j
  );
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Later migrations call this for new tables.
CREATE OR REPLACE FUNCTION attach_audit(tbl text) RETURNS void AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()',
                 tbl || '_audit', tbl);
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Audit everything a person edits. Not audited: the ledger and bill lines (they are their own
-- history, with user and time on each row), derived tables, and the audit log itself.
SELECT attach_audit(t) FROM unnest(ARRAY[
  'outlet', 'app_user', 'role', 'role_permission', 'user_role', 'setting', 'approval_request',
  'tax_class', 'category', 'brand', 'stock_item', 'stock_item_unit', 'stock_level', 'menu_item',
  'recipe_line', 'margin_target', 'store', 'stock_count', 'stock_count_line', 'vendor', 'vendor_item',
  'indent', 'indent_line', 'receipt_check', 'receipt_check_line', 'goods_received_note', 'return_note',
  'vendor_payment', 'price_rule', 'dining_table', 'bill', 'payment', 'day_close'
]) AS t;
--> statement-breakpoint

-- Append-only tables: history is never edited or removed. Corrections are new rows.
CREATE OR REPLACE FUNCTION reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed. Post a reversing entry instead.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER stock_ledger_append_only BEFORE UPDATE OR DELETE ON stock_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER vendor_rate_append_only BEFORE UPDATE OR DELETE ON vendor_rate
  FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
-- Bills are cancelled or refunded, never deleted.
CREATE TRIGGER bill_no_delete BEFORE DELETE ON bill FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER bill_order_no_delete BEFORE DELETE ON bill_order FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER order_line_no_delete BEFORE DELETE ON order_line FOR EACH ROW EXECUTE FUNCTION reject_change();
--> statement-breakpoint
CREATE TRIGGER payment_no_delete BEFORE DELETE ON payment FOR EACH ROW EXECUTE FUNCTION reject_change();
