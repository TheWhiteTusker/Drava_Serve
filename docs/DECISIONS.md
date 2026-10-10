# Decisions log

Choices made while building that neither the handoff nor the build brief settled. One line of reasoning each. Newest phase at the bottom.

## Needs checking by a professional before go-live

Nothing in this system or its documents says that discounts on liquor are legally permitted. These items are built as placeholders that follow handoff section 6.15 and must be confirmed:

| Item | Who checks | Where it lives |
| --- | --- | --- |
| Food GST at 5% (CGST 2.5 + SGST 2.5) for a standalone restaurant | CA | Tax classes screen (`tax_class` table) |
| Liquor tax rate (seeded as 0% and labelled "rate not set") and how it prints | CA | Tax classes screen |
| Food and liquor totalled separately on one bill; rounding to the nearest rupee | CA | `packages/shared/src/money.ts` |
| Automatic beverage offers on alcohol, and the per-outlet owner switch | Karnataka excise consultant; lawyer | Settings → Beverage offers (off by default) |
| Daily per-label liquor register format (phase 2) | Excise consultant | Inventory reports |
| FSSAI number on every bill; veg / non-veg marks; allergen display | Lawyer / FSSAI consultant | Outlet record; menu item diet type and allergens |
| Personal data handling under the DPDP Rules 2025 (staff names and phones, vendor contacts; no guest data) | Lawyer | Hosting and data export / deletion (phase 6) |

## Phase 1

**Tenancy and data**
- **Sign-in routing by login.** The control database maps each login (email or phone) to one customer, so staff sign in without typing a customer code. A person who works for two customers needs two logins.
- **Same database server role for all customer databases (local).** Production should give each customer database its own credentials and encryption key; noted for the hosting setup, not built yet.
- **Customer-wide master data, outlet-owned operations.** Categories, brands, stock items, vendors, tax classes and roles are shared across a customer's outlets; stores, menu items (with their prices and recipes), stock levels, the ledger, bills, indents, receiving, offers and setting overrides each belong to an outlet. This is how "every record belongs to an outlet" was read: a tomato is the same ingredient everywhere, but its stock, par level and dish prices are per outlet.
- **Menu items are per outlet.** Each outlet can have its own menu and prices; the sample data copies one menu to both outlets.
- **Par, reorder and critical levels are per outlet** (`stock_level`), not on the stock item, because two outlets of different sizes need different levels.
- **Liquor tree.** Brands are a flat list; the product (a stock item, department Beverage, unit ml) carries its liquor sub-type and brand. This lets one brand (for example Bacardi) appear under rum and ready-to-drink without duplicate brands.
- **"Cocktails" added as a liquor type** so cocktails sit on the beverage side with liquor tax. Mocktails and soft drinks use the food course "Soft beverages" (as listed in handoff 6.6) with food tax.
- **Diet type is required for food, not for liquor.** Egg is stored as its own value and shown with the non-veg mark.
- **Menu prices are before tax**; tax is added on the bill, food and liquor separately, and the total is rounded to the nearest rupee with a round-off line. Common practice in India; please confirm (see "Needs from you" in the phase 1 summary).
- **Money and quantities** are PostgreSQL `numeric`, moved as strings and calculated with decimal.js. Unit costs keep 6 decimals (₹ per gram can be small).

**Access**
- **Managing users, roles, outlets and tax classes needs the permission for all outlets.** Otherwise an outlet manager could give themselves an all-outlet role.
- **Changing a menu price needs `prices.manage`** on top of `catalog.manage`. The approval step for large price changes arrives with the pricing engine (phase 4).
- **Lockout:** 5 wrong passwords or PINs in a row lock that user for 15 minutes. Sessions last 12 hours (a shift).
- **PIN switch** lists active users with a PIN who work at the current outlet; the new user must work at that outlet.
- **Seed roles** follow handoff 6.12. Small additions: Outlet manager also has `approvals.decide` and `audit.view`; Storekeeper and Chef have `rates.view` (Watchman does not).

**Audit and history**
- **Audit is written by a database trigger** on every table people edit, so no code path can skip it. The API tags each transaction with the user and device. Changes made by the system (setup, sample data) show user "system" and a device such as `system:seed`. Password and PIN hashes are stripped from the log.
- **Append-only by database trigger:** stock ledger, audit log, vendor rate history. Bills, orders, order lines and payments cannot be deleted (status changes only).
- **Approval queue:** the table exists; its screens arrive with the first thing that needs approval (wastage write-offs in phase 2).

**Settings**
- Indent cut-off defaults to 23:00 (India time), set for the business and overridable per outlet. Indent mode (approve or auto-send) is business-wide, as in handoff section 5.
- Example defaults not chosen by you: rate tolerance 10%, price-change approval limit 10%, "few left" at 5 portions. All editable on the Settings screen.
- **The beverage offer switch is off by default** for every outlet. The sample data turns it on at the first sample outlet only, to show both states.

**Tax configuration**
- Tax classes are data (code, name, food or liquor, and components such as CGST and SGST with rates), editable on the Tax classes screen by anyone with `tax.manage`. No rate is in code.

**Tooling**
- **TypeScript 6.0**, not 7.0: TypeScript 7 is the new native compiler and the linter and bundler tools do not support it yet.
- **NestJS 12 is ES-module only**, so the API is an ES module project.
- **Drizzle ORM** for the schema, SQL migrations and row locks (`SELECT … FOR UPDATE`). Migrations are plain SQL files in `apps/api/migrations`.
- **SeaweedFS** as the local S3-compatible store: MinIO no longer publishes Docker images. Any S3-compatible service works in production.
- **Sample data** is generated with a fixed random seed so the sample week is the same every time. All names, prices, costs, GSTIN, FSSAI and licence numbers in it are made up.
