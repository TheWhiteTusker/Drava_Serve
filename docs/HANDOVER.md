# Developer handover

For White Tusker's developers taking over the F&B management system. Read [README.md](../README.md) first for commands and layout; this document covers how the pieces fit, how to do the common jobs, and what is still open.

## 1. How it fits together

```
Browser apps (Vercel services admin and field; see vercel.json)
  /            admin + dashboard (apps/admin)
  /pos/        billing POS, installable, offline queue (apps/field/pos)
  /receiving/  receiving app, installable, offline queue (apps/field/receiving)
  /m/<c>/<o>[/<table>]   guest QR menu, no sign-in (apps/field/menu); a table's code also takes orders
        │  REST /api/*      WebSocket /api/socket (socket.io)
        ▼
API (NestJS, apps/api; Vercel service api)  ── Redis (optional): socket.io adapter + BullMQ jobs
        │
        ├─ control DB (fnb_control): customer, login_route
        ├─ one PostgreSQL DB per customer (fnb_c_<code>): everything else
        └─ S3-compatible storage: bucket fnb-<code> per customer, fnb-backups
```

- **Request path.** `AuthGuard` (`src/common.ts`) verifies the token, resolves the customer from the control DB, attaches a `Ctx` holding only that customer's DB pool and the user's grants, then checks `@Permit`. Controllers call `ctx.assert(permission, outletId)` for outlet-level checks. Every write goes through `ctx.tx()`, which tags the transaction with user and device for the audit trigger.
- **Stock.** All stock changes go through `postMoves` / `stockTx` in `src/stock.ts`: balance rows locked in a fixed order, ledger rows appended, weighted average updated, earliest-expiry-first lots. After commit, `afterStock` recomputes portions available, pushes live events, re-ranks when something sells out or comes back, and runs the offer engine on beverage movements.
- **Rules with numbers** are pure functions in `packages/shared/src/rules.ts` (indent quantity, portion cost, margin, suggested price, ranking, offer selection, availability, status, menu engineering, business day) and `money.ts` (bill totals and taxes), each with tests. The API and the POS use the same functions.
- **Approvals.** `src/approvals.ts`: `proposeOrApply` applies directly when the proposer may approve, otherwise queues; handlers are registered per type (`registerApproval`) in the controller files. Nobody approves their own request.
- **Jobs.** `src/jobs.ts`: a BullMQ job every minute runs `tick()`: nightly indent at each outlet's cut-off, delivery list by 04:30, day-end offer release. `job_run` rows make each run happen once and catch up after downtime. Backup runs at 02:00 (`src/data.ts`).
- **Dashboard.** Paying a bill calls `rollupBill` (`src/reports.ts`) in the same transaction, which adds to `sales_hourly`, `sales_daily` and `bill_hourly`; cancelling a paid bill subtracts. Dashboard queries read only these.
- **Tests.** `packages/shared/src/*.test.ts` (rules) and `apps/api/test/phase*.e2e.test.ts` (one end-to-end flow per phase, each on its own throwaway customer database). `test/fixture.ts` builds an outlet that mirrors the handoff's worked examples.

## 2. Running it

- Local: the Set up and Run steps in the README, against the development Neon project.
- **Production checklist:**
  - Set `JWT_SECRET` (optional for now: without it, production derives the session key from `POSTGRES_URL`), `POSTGRES_URL`, `CONTROL_DB_NAME`, `REDIS_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `CORS_ORIGIN`, and optionally `BACKUP_BUCKET`, `BACKUP_KEEP_DAYS`, `TENANT_POOL_MAX`.
  - Use managed PostgreSQL 17 and S3-compatible storage in an India region, with encryption at rest.
  - Give each customer database its own PostgreSQL role. Today all customer databases share the server role in `POSTGRES_URL`; per-customer credentials are an open item.
  - Serve over HTTPS. The installable apps (service workers, camera, share sheet) need it.
  - Run more than one API instance if needed: live updates and jobs already go through Redis. Put PgBouncer in front once there are many customers (see the `ponytail:` note in `src/db/index.ts`).
  - Every production deploy on Vercel migrates the control database and every customer database before the new code goes live (the `api` service's build command). To migrate on purpose: `pnpm db:migrate` with `POSTGRES_URL` set.
  - The sample demo customer is created only by `pnpm seed`. Don't run it against a production database that holds real customers.

## 3. Adding a customer

```powershell
$env:POSTGRES_URL="<production URL>"
pnpm customer:create sharma "Sharma Hospitality Pvt Ltd" --owner-login owner@sharma.example --owner-password '<temporary>' --owner-name "Owner"
Remove-Item Env:POSTGRES_URL
```

This adds the control row, creates `fnb_c_sharma`, runs every migration, loads the starting catalog (seed roles, courses, the liquor tree from handoff 6.6, starter brands and two tax classes) and creates the owner sign-in. The owner then signs in, adds outlets (each gets main, kitchen and bar stores, plus an offer rule switched off), users, stock items and menu items. Opening stock goes in as a first stock count.

The customer code (`sharma`) is permanent. It appears in the database name, the storage bucket and the guest menu address `/m/sharma/<outlet code>`.

## 4. Dropping in the brand theme

Edit only `packages/theme/`:
- `theme.css`: every `--brand-*` token in the light block and in both dark blocks; the font `@import` lines at the top and `--brand-font` / `--brand-font-heading` (fonts are bundled via `@fontsource` packages in `packages/theme/package.json`, so add the brand's font the same way rather than linking Google Fonts); the `--chart-*` tokens if the accent changes. Re-check chart colours with a colour-blind-safety validator before changing them.
- `logo.svg` (for light backgrounds) and `logo-dark.svg` (for dark), or point `--brand-logo` at other files.
- `apps/field/public/icon.svg` is the installed-app icon. The `theme_color` values in `apps/field/public/{pos,receiving}/manifest.webmanifest` should match the brand colour.
- Don't change the `--mark-veg` / `--mark-nonveg` tokens; they follow FSSAI conventions.

## 5. Adding the WhatsApp Business delivery channel

Vendor orders are sent through the `DeliveryChannel` interface in `apps/api/src/purchasing.controller.ts`:

```ts
interface DeliveryChannel {
  id: string; label: string; automatic: boolean;
  send(order: { customerCode; indentId; vendor; pdf: Buffer }): Promise<{ ok: boolean; detail?: string }>;
}
export const deliveryChannels: DeliveryChannel[] = [manualShare];
```

To add WhatsApp Business:
1. Write `whatsappBusiness: DeliveryChannel` with `automatic: true`. Its `send()` uploads the PDF as a document message to `vendor.phone` through the WhatsApp Business (Cloud) API and returns `{ ok, detail }` (for example the message id or the error).
2. Add it to `deliveryChannels`. `sendAutomatically()` already runs every automatic channel after an indent is approved, either by a manager or by the nightly job in "send automatically" mode, and records each attempt in `delivery_send`.
3. Put the API token and phone-number id in environment variables. If a customer brings their own WhatsApp Business account, add them as per-customer settings.
4. Optionally gate it per customer with a setting. Nothing in the indent, PDF, approval or receiving code needs to change.

## 6. Where settings live

| What | Where | Who changes it |
| --- | --- | --- |
| **Tax rates** | `tax_class` table per customer (code, name, food or liquor, components such as CGST/SGST with rates). Admin → Catalog → Tax classes. Seeded by `SEED_TAX_CLASSES` in `apps/api/src/bootstrap.ts` | Owner (`tax.manage`) |
| **Beverage offer settings** | `price_rule` table, one per outlet: trigger serves, discount %, price band, match scope, margin floor, substitute stock, limit, release buffer. Admin → Pricing → Beverage offers. Defaults on the table in `src/db/tenant-schema.ts` | Owner (`pricing.rules`) |
| **Liquor offer on/off** | `setting` key `offers.liquorEnabled`, per outlet, off by default. Admin → Settings | Owner (`offers.liquorSwitch`) |
| **Indent cut-off and mode** | `indent.cutoff` (default 23:00, per customer or outlet), `indent.mode` (approval or auto) | `settings.manage` |
| **Tolerances and limits** | `receiving.rateTolerancePct` (10), `approvals.priceChangeLimitPct` (10), `pricing.flagTolerancePct` (2), `menu.lowThresholdServes` (5), `business.dayStart` (05:00) | `settings.manage` |
| **Margin targets** | `margin_target` (outlet and course/type) and `menu_item.target_margin_pct`. Admin → Pricing → Margin targets | Owner (`pricing.rules`) |
| **Setting defaults** | `SETTING_DEFAULTS` in `packages/shared/src/constants.ts`; validation in `SettingsController` (`src/access.controller.ts`) | Developers |
| **Permissions and seed roles** | `packages/shared/src/permissions.ts`. Roles are editable in the app; a new permission needs a migration that grants it to existing roles (see `migrations/tenant/0002_phase2_inventory.sql`) | Developers |

## 7. Common development jobs

- **Schema change:** edit `apps/api/src/db/tenant-schema.ts`, run `pnpm --filter @fnb/api db:generate`, review the SQL, and add `SELECT attach_audit('<table>')` for any new table people edit. The next API start (or `pnpm db:migrate`) applies it to every customer.
- **New approval type:** `registerApproval('type', 'Label', handler)` in a controller file, then call `proposeOrApply` where the change is requested.
- **New live event:** `publish(customerId, outletId, event, data)` in `src/events.ts`; listen with `useLive` (admin) or the socket in the POS.
- **Restore a customer:** `node dist/cli.js backups <code>`, then `node dist/cli.js restore <code> [YYYY-MM-DD]`. Restore replaces the whole database, so tell the customer first.

## 8. Open items

**Decisions still needed from the product owner** (also listed at the end of each phase summary):
1. Menu prices before tax (built) or tax-inclusive?
2. White Tusker logo and brand colours.
3. Should the vendor PDF show prices?
4. Receiving unplanned deliveries (goods that weren't ordered): wanted?
5. Guest menu: hide sold-out items instead of greying them?
6. Bill numbering: one series per POS device. Acceptable?
7. Receipt printer models, for a direct printer driver.
8. Backup retention (30 days now) and retention after a customer leaves.
9. Subscription billing (how restaurants pay White Tusker) is deliberately not built.

**Legal and professional checks before go-live** (nothing in the app or docs says liquor discounts are permitted):
- **CA:** GST 5% on food for standalone restaurants; liquor VAT rate and how it prints (seeded at 0%, labelled "rate not set"); food and liquor totals on one bill; rounding to the rupee; invoice numbering series; manual discounts before tax.
- **Karnataka excise consultant:** automatic offers on alcohol under the bar licence; the daily per-label register format; whether day-close and register snapshots meet inspection needs.
- **Lawyer:** DPDP Rules 2025 (staff and vendor personal data, breach reporting, retention and deletion on exit, support access); FSSAI display rules (licence number on bills, veg/non-veg marks, allergens, calories for chains of 10+ outlets).

**Technical follow-ups:**
- Per-customer PostgreSQL roles and encryption keys; PgBouncer once there are many customers.
- Time-limited, logged White Tusker support access on the customer's approval (handoff 6.14), which isn't built.
- Direct receipt-printer driver (`apps/field/src/pos/printing.ts` is the seam) and the WhatsApp Business channel (section 5).
- Offline photos in the receiving app wait in IndexedDB. Very large batches on low-storage phones haven't been tried.
- The POS stores its open bills in the browser's local storage. Clearing browser data on a counter with unsent bills would lose them; IndexedDB would be sturdier.
- Accessibility has been designed in (shape-based marks, 44 px targets, focus states, keyboard shortcuts, chart table views) but not audited with a screen reader.
- The real-device install flow for the POS and receiving apps (home-screen install over HTTPS) has not been tried on actual tablets and phones.
