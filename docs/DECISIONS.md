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

## Phase 2

- **Sales draw from the kitchen store (food stock) or the bar store (beverage stock).** "Portions available" is worked out from that store, so moving stock from the main store into the kitchen or bar is what makes it sellable.
- **Portions available subtract what open bills have already ordered.** Two counters cannot both sell the last portion: the second is told it just sold out (phase 5 uses this).
- **Recipe quantity is the amount in the dish; yield says how much survives preparation.** Stock drawn = quantity ÷ yield. 250 g at 80% yield draws 312.5 g.
- **Who can write off without approval:** a new permission, "Record wastage, spillage and breakage without approval", is given to Owner, Outlet manager and Chef / bar manager (handoff 6.12 lets the chef and bar manager change wastage and spillage directly). Storekeepers' write-offs go to the approval queue.
- **Complimentary and staff meals always name an approver.** If the person recording it can approve, they are the approver; otherwise it waits in the queue.
- **Count corrections are approved by a manager.** A manager's own count goes straight in (handoff: managers can change stock corrections); anyone else's waits. The correction posted is counted − what the books said when the count started.
- **Nobody approves their own request.** A request goes straight in when the person raising it could approve it anyway (for example a manager recording their own spillage); otherwise someone else must approve it.
- **Opening stock for a new customer is entered as a stock count.** The count shows the books at zero; the counted quantity becomes the correction, with an audit trail.
- **Lots and expiry:** perishables get a lot on every receipt, dated by the expiry entered (or received date + shelf life). Stock that existed before lot tracking is treated as one lot with no expiry and is issued after dated lots.
- **A negative balance is allowed only for sales recorded offline** (phase 5); everything else is refused with "Not enough …".
- **Weighted average** moves only on receipts; issues are costed at the current average. Stock value uses the average; menu costing (phase 4) uses the latest billed rate, as the handoff says.
- **Business day** starts at 05:00 India time by default (a setting), so a bar's 1:30 am sales belong to the evening before. The liquor register and day close use the business day.
- **Liquor register** lists every beverage stock item with an alcohol % above zero. Transfers inside the outlet are not shown (they net to zero for the licence); wastage, breakage, counts and reversals show as "Other". The format must be checked with an excise consultant.
- **Live updates** use WebSocket (socket.io) with the Redis adapter, one room per customer and outlet.

## Phase 3

- **Indent timing.** The nightly indent is for the next 5:00 am delivery and is built at the cut-off the evening before (a cut-off after midnight and before 5:00 am counts as that same night). A one-minute scheduler checks every outlet; each night's indent is built exactly once and catches up if the server was down.
- **"On order"** = approved deliveries not yet gate-checked, plus other days' indents still awaiting approval. Rebuilding an indent replaces it only while it is awaiting approval.
- **Items with a par level but no vendor** are listed after a manual build so a manager can assign one.
- **In "send automatically" mode** the indent is approved automatically. At launch there is no automatic channel, so someone still taps Share; once a WhatsApp Business channel is added, approval sends it.
- **Delivery channel.** One working channel, "manual share", covers Share (the phone's share sheet, so WhatsApp works), Download and Print. Every attempt is recorded with channel, method, time, person and result. A share the person cancels is recorded as failed.
- **The vendor PDF shows items and quantities, not prices.** A copy is kept in the customer's private storage.
- **Gate reasons** (watchman): not fresh, spoiled, wrong item, damaged, short weight, other. **Re-check reasons** (staff): spoiled, expired, unusable.
- **The vendor's bill is assumed to include what staff later rejected** (the delivery person has gone), so the goods received note shows bill − returns = payable. Items rejected at the gate left with the delivery person and are not on the bill.
- **Watchman and staff must be two different people** to sign the goods received note.
- **The rate check compares each billed rate (per base unit) with the last rate paid for that item from any vendor.** Above the tolerance (default 10%), the note is held and a manager must release it before accounts can pay it.
- **Received stock goes into the item's issuing store** (kitchen for food, bar for beverages), so it is sellable at once.
- **Photos and bills** are stored in a private bucket per customer and only served through the API. The watchman can see gate photos but not the vendor's bill.
- **Vendor payment modes:** bank transfer, UPI, cheque, cash. A note is "paid" once payments reach the payable amount.
- **The receiving app works offline.** Each action is saved on the phone and sent in order when the connection returns; photos taken offline wait on the phone too.
- **Unplanned deliveries** (a vendor arriving with no indent) are not handled yet. Open item.
- **Background jobs** run through BullMQ on Redis (one runner across API instances).

## Phase 4

- **Menu costing uses the latest billed rate;** stock value uses the weighted average, as the handoff says.
- **Ranking ties** beyond units sold are broken by name, so the order is stable. **Pins:** a pinned dish goes to the top of its course, in pin-number order.
- **Ranking runs** after re-costing, after a price, recipe or pin change, and when a dish sells out or comes back. Beverages are ordered by type, sub-type, brand, serve size and name.
- **Suggested price** = portion cost ÷ (1 − target), rounded up to the next whole rupee. A dish is flagged when its margin is under target by more than 2 points (setting "pricing.flagTolerancePct").
- **Price-change limit:** a manager's price change of more than 10% (setting) goes for approval; the owner (who sets pricing rules) changes prices directly. A flag raised by re-costing is a system request any approver can approve.
- **Recipe changes** that take a dish under target go for approval unless the person can approve.
- **Offer matching:** "same type and serve size" means the same liquor type (e.g. whisky) and the same ml. The rule can be narrowed to the same sub-type. Each beverage is on at most one offer at a time.
- **Offers start** on every beverage stock movement, when the owner switches offers on, and when a rule or price changes. **They end** when the low item is above trigger + buffer ("restocked"), when a substitute itself runs low, when the switch is turned off, and at the start of the next business day.
- **"Applies only to new bills":** the offer price applies to bills opened after the offer started. Lines already on a bill keep their price.
- **Every new outlet gets one offer rule** with the handoff's example settings. Nothing runs until the owner switches offers on for that outlet.
- **The guest menu shows sold-out items greyed** (not hidden), at `/m/<business code>/<outlet code>`. It refreshes every minute, says prices are before taxes, and shows the FSSAI number. It sets no cookies and collects nothing about guests.

## Phase 5

- **The last-portion check happens when an order is placed, stock is deducted at payment.** An online order locks the stock rows it needs and checks what is left after other open bills' orders; the loser of a race is told "Just sold out: … (0 left)" and the item is greyed. Payment then deducts per recipe in one transaction and is never refused for stock (a shortfall, e.g. stock written off in between, shows in the ledger).
- **Offline bills** are priced as the device showed them (prices and sold-out marks as of the last sync) and are stored exactly once, keyed by ids the device creates. Changes go to the server strictly in the order they were made.
- **Bill numbers come from the device** so bills can be numbered offline: `OUTLET-YYMMDD-<device tag><sequence>`, e.g. `BLR1-261010-6F001`. The server keeps them unique per outlet. Bills created through the API without a number get `OUTLET-YYYYMMDD-S001`. GST invoice-series rules must be confirmed with a CA.
- **A bill's time** runs from its first order to payment; the business day is taken from the payment time.
- **Manual discounts are a percentage** of the bill, taken off before tax on both food and liquor, and printed as a "Discount" line (unlike beverage offers, which are silent). Discounts, removing an item after it was sent, cancellations and refunds all need a manager's approval.
- **Cancelling a paid bill** returns its stock (a reversal in the ledger) and removes it from the dashboard. A refund records a negative payment; a fully refunded bill is marked refunded.
- **Day close** refuses while that day still has open bills. It records totals by tax and payment mode, the cash counted and the difference, a snapshot of the liquor register, and ends that day's offers. A day can be closed once.
- **"Sent to the guest"** uses the device's share sheet with a text receipt (no guest phone number or email is collected).
- **Receipt printing** uses the browser's print dialog with an 80 mm thermal layout; `apps/field/src/pos/printing.ts` is the one place to swap in a direct printer driver.
- **The counter's outlet** is chosen once per device (skipped when the person works at only one outlet).

## Phase 6

- **Revenue on the dashboard is before tax and after approved discounts**, by the price actually charged. Cost is the portion cost at the time of sale.
- **Demand by hour** uses the time each order was given; **time spent** is grouped by the hour the bill opened.
- **"Litres of alcohol"** is the volume of liquor served (ml of products with an alcohol % in each recipe), not pure alcohol.
- **"Margins that fell after a price change"** compares each dish's latest re-costing with the one before it.
- **Offer impact** compares an offer's period with the same length of time just before it started, using the hourly summaries.
- **Menu engineering** uses margin per plate (₹) against the menu's average for "high margin", and the handoff's 70% rule for "popular". Food and beverage are assessed separately.
- **Pour cost** = cost of liquor-tax items sold ÷ their sales.
- **Backups** run nightly at 02:00 India time: one compressed `pg_dump` per customer into the private `fnb-backups` bucket, kept 30 days (setting `BACKUP_KEEP_DAYS`). Restore and per-customer deletion are command-line operations for White Tusker staff, not buttons in the app.
- **Data export** for the owner is a zip of every table as CSV (password and PIN hashes left out).
