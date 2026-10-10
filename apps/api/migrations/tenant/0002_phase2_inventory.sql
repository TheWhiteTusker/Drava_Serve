CREATE INDEX "stock_ledger_lot_id_index" ON "stock_ledger" USING btree ("lot_id");--> statement-breakpoint
-- New permission: record write-offs without approval. Added to the seed roles that the handoff
-- allows to change wastage directly (owner, outlet manager, chef / bar manager).
INSERT INTO role_permission (role_id, permission)
SELECT id, 'inventory.writeOff' FROM role WHERE name IN ('Owner / admin', 'Outlet manager', 'Chef / bar manager')
ON CONFLICT DO NOTHING;
