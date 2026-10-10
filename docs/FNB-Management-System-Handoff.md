# F&B Management System — Handoff

Prepared 9 October 2026 for a Claude session on a different account.

## 1. How to use this file

You are picking up a product-design project from another Claude account. Nothing from that account carries over: not its memory, not its project files, not its documents. This file is the whole context, so read it fully before answering the user.

- Sections 2 to 5 tell you who the user is, what has been done, and what they decided.
- Section 6 is the complete architecture as it stands. Treat it as the current agreed design, not a draft to redo.
- Section 7 is the next piece of work, which is on hold until the user asks for it.
- Section 8 lists what is still uncertain. Do not present those points as settled.

Three diagram images accompany this file (`diagram-1-architecture.png`, `diagram-2-receiving-flow.png`, `diagram-3-daily-loop.png`). They are optional; everything in them is also written out in section 6.

## 2. The user and how they work

- The user works at White Tusker Private Limited, a software company. Its existing products include a CMS and an ERP (attendance, tasks, leaves, procurement, vendor management, BOQ).
- They are designing a food and beverage management system as a new product to sell to restaurants and bars. They are the product owner, not the developer writing the code in this conversation.
- They write quickly and informally. Read for intent, and state the reading you took.
- They prefer plain language and concrete examples (for instance "tomato is 20 a kg today and 50 tomorrow").
- They like being asked the open questions as multiple-choice questions, a few at a time. They answered sixteen that way in one sitting.
- They decide the pace. When they said "don't design it now, just be ready", they meant it: do not start a piece of work they have put on hold.
- They are in India (timezone Asia/Calcutta). Amounts are in rupees.

## 3. Status at handoff

| Item | Status |
| --- | --- |
| Architecture document | Complete for everything described so far. Its full content is in section 6 |
| Open questions | Sixteen answered (section 5). Six still open (section 8) |
| POS and dashboard screen designs | Not started. On hold at the user's request. Brief in section 7 |
| Code, database schema, API specification | Not started and not yet requested |

Where the originals live, all private to the first account unless the user shares them:

- Architecture document: https://claude.ai/code/artifact/e744cfc8-3bbe-4176-80ec-4b9499519248
- Empty design canvas named "F&B POS and Dashboard": https://claude.ai/artifact/NtDhyT6XSBZBZU2t6f1hBX

If you cannot open those links, work from this file. The user can also export the document from its own menu and attach it.

## 4. The user's briefs, in their own words

### First brief

> i want an food and beverage management system so it must have a inventory system keeps a track of t and if one thing is less in stock then it gives a set percent of discount on items that have a higher price(not too high but around it) and if it has food it must have an option where we set our margins and the food with the best margin will show on the top create an architecture and food will have categories veg non veg starters appetizers main course desert and those and we also need brands and types of booze so analyze do a research and provide a architecture multiple people will use it so create accordingly

### Second brief

> so there will be a rates of inventory (cost price) and this will have 2 parts food and beverage so all the inventory is tracked and every night indent will be raised of what the items needs to be delivered and a list of items needed is generated and sent to the vendor which will be in a pdf format and the next morning at 5 the watchman will check the items that have been delivered and will vaguely check the items and if something is not fresh or spoiled he returns the items then and there then the updated item list is accepted and kept inside then the staff which comes afterwards will reverify and if something is still spoilt or expired or unusable then the list is updated again and issues are noted with photos with both the watchman and the staff will generate a goods received notes which will say that these are the final approved which is accepted and these are items which are to be added in the inventory and is forwarded to the acountas team to dispatch the amount
>
> and the rates are maintained with a vendors list and suppose tomato is got for 20/kg and the next day it is bought for 50/kg so we have to calculate margin based on the receipes they have to manually add everything one time so that they get a exact hold of the margins per dish so if some ingredient price has increased the margins will go sown and if margins go down then that food product will be shown down in the list to maximize the profits and the customer buys whatever comes in the first and this order will be type wise so starters will have the descendig order with respect to margins then main course will have the same thing and the desert the same thing
>
> now lets look at the client perspective
> food = max margin dish comes on top
> beverage = offers based on stock
>
> now lets look and i want to design a pos and dashboard (all the margins, stock, statistics on this weekday this item goes on demand and time wise also ) highest selling drinks and beverage , top brands sold, total alcohol/food sold and the time spent and all those analytics
>
> and the pos will be an user friendly billing system so they use this only to generate receipts for the orders and the receipts

### Later instructions

- "i dont want you to design it now just be ready" (about the POS and dashboard screens)
- "make the architecture"
- "ask me the questions that you have doubt"

## 5. Decisions the user has made

| Topic | Decision |
| --- | --- |
| Who it is for | A product sold to many restaurants, each customer's data kept separate |
| Existing ERP | Separate product, with its own purchasing and vendor screens |
| First customers | Several outlets in one state, Karnataka |
| Beverage offers | When a beverage runs low, similar beverages priced slightly above it get a set % off |
| Offer start | Automatic |
| Food ranking | By margin %, inside each course |
| Guest menu | QR code scanned on the guest's own phone |
| Purchase rate | Taken from the vendor's bill on delivery |
| Vendor order PDF | Shared on WhatsApp, or downloaded and printed |
| Indent approval | A setting per customer: a manager approves, or it goes out automatically |
| Time spent (dashboard) | From the first order on a bill to its payment |
| POS device | Must work with touch and with mouse and keyboard |
| POS offline | Must keep billing when the internet is down |
| POS scope | Billing and receipts only |
| Screen design look | White Tusker's own brand. Logo and colours not yet shared |
| Hosting | The user asked for a recommendation "because of privacy issues". One was given (section 6.14) and is awaiting their confirmation |

## 6. The architecture

### 6.1 Core idea

Each customer has one append-only stock ledger. Every bill deducts recipe quantities from it: grams or pieces for food, millilitres for liquor. Live stock and the latest billed purchase rates drive the two customer-facing rules:

- **Food:** inside each course, dishes are listed by margin %, highest first.
- **Beverage:** offers based on stock.

### 6.2 Layers (diagram 1)

- **Apps:** Admin web; Billing POS; Receiving app; Guest menu (QR). One sign-in per person.
- **API:** sign-in, role checks, live updates to every device.
- **Modules:** nine, listed below. Four form the path that carries both rules: POS billing → Inventory → Pricing engine → Menu engine.
- **Data:** PostgreSQL (one database per customer); Redis (live events, background jobs); file storage (menu photos, invoices, receiving photos).

### 6.3 The daily loop (diagram 3)

1. **Night, at cut-off.** Indent raised from the shortfall against par; PDF order goes to each vendor.
2. **5:00 am.** Gate check: the watchman accepts or returns each delivered line.
3. **Morning.** Staff re-check; the goods received note (GRN) puts accepted items into stock and goes to accounts.
4. **Before opening.** New rates re-cost every recipe; each course is re-ranked.
5. **Service hours.** Each POS bill deducts stock; a low beverage triggers offers.
6. **Through the day.** The dashboard updates. That night's stock sets the next indent.

### 6.4 Modules

| Module | What it does | Main users |
| --- | --- | --- |
| Catalog | Menu items, categories, liquor types and brands, recipes, modifiers | Manager, chef |
| Inventory | Stock ledger, stores, goods receipt, transfers, wastage, stock counts, low-stock alerts | Storekeeper, manager |
| Purchasing | Vendor rate list, nightly indent, PDF order to each vendor, two-stage receiving, goods received note, hand-off to accounts | Manager, watchman, storekeeper, accounts |
| Recipe costing | Cost per portion or per peg from current purchase cost and yield | Chef, bar manager |
| Pricing engine | Margin targets, suggested prices, beverage offers by stock, price approval | Owner, manager |
| Menu engine | Builds the live menu: availability, ranking by margin, active offers | Everyone (read) |
| POS billing | Bills, payments, receipts, tax split | Cashier |
| Reports | Dashboard: sales, margins, stock value, demand by weekday and hour, top sellers and brands, pour cost, variance, offer impact | Owner, accounts |
| Access and audit | Users, roles, outlets, approval queue, change history | Admin |

### 6.5 Apps and screens

| App | Used by | Device | Screens |
| --- | --- | --- | --- |
| Admin web | Owner, manager, chef, storekeeper, accounts | Desktop browser | Catalog and recipes; vendor rate list; indent review and approval; goods received notes and payments; stock, counts and wastage; margin targets and offer rules; dashboard; users and roles |
| Billing POS | Cashier | Counter tablet or desktop; touch, mouse and keyboard; works offline | New bill; open bills; payment; receipt; day close |
| Receiving app | Watchman, storekeeper, kitchen staff | Phone | Today's deliveries; gate check; staff re-check with photos; goods received note sign-off |
| Guest menu | Guests | Their own phone, by QR code at the table | Food by course in margin order; beverages by type with offers |

The receiving app is deliberately the simplest: large buttons, one delivery line at a time, a photo button, and no prices.

### 6.6 Menu catalog

Diet type and course are two separate fields on a food item.

| Field | Values | Notes |
| --- | --- | --- |
| Diet type | Veg, Non-veg, Egg | Drives the veg / non-veg mark on menu and bill. Egg is treated as non-veg |
| Course | Starters, Appetizers, Soups and salads, Main course, Breads and rice, Sides, Desserts, Soft beverages | Editable list. One course per item |
| Tags | Cuisine, spice level, chef's special, Jain | Optional, many per item |
| Allergens | Milk, nuts, gluten, egg, soy, shellfish | Shown next to the item |

Liquor uses a four-level tree: type → sub-type → brand → product (one bottle size of one label). Stock is held at product level; reports roll up to brand and type.

| Type | Sub-types | Example brands (a seed list, to be edited per customer) |
| --- | --- | --- |
| Whisky | Indian, Blended Scotch, Single malt, Irish, Bourbon, Japanese | Royal Stag, Blenders Pride, Johnnie Walker, Glenfiddich, Jameson, Jim Beam |
| Rum | White, Dark, Spiced | Old Monk, Bacardi, Captain Morgan |
| Vodka | Plain, Flavoured | Smirnoff, Absolut, Magic Moments |
| Gin | London dry, Indian craft, Flavoured | Bombay Sapphire, Tanqueray, Greater Than |
| Brandy | Indian, Cognac | McDowell's No.1, Hennessy |
| Tequila and mezcal | Blanco, Reposado, Añejo | Jose Cuervo, Patrón |
| Liqueurs | Coffee, Cream, Herbal, Orange | Kahlúa, Baileys, Jägermeister, Cointreau |
| Beer | Lager, Strong, Wheat, Craft, Draught | Kingfisher, Budweiser, Bira 91, Hoegaarden |
| Wine | Red, White, Rosé, Sparkling | Sula, Grover Zampa, Jacob's Creek |
| Ready-to-drink | Breezers, Hard seltzers | Bacardi Breezer |

Each liquor product also records origin (Indian-made or imported), price tier, bottle size in ml and alcohol %. One bottle sells as several menu items (30 ml, 60 ml, bottle; glass and bottle for wine; pint, mug, pitcher for beer), each with its own price and each deducting its own volume. Cocktails and mocktails are recipe items.

### 6.7 Inventory

- Stock is never edited directly. Every receipt, sale, transfer, wastage and count correction is a row in the ledger; the balance is the sum of the rows.
- Stock items are held in a base unit (g, ml, pieces) with a purchase-unit conversion. Liquor is held in ml per label, so partial bottles count.
- Every stock item belongs to one of two departments: Food or Beverage.
- Each outlet has a main store, a kitchen store and a bar store; transfers move stock between them.
- Every menu item has a recipe. A 60 ml peg deducts 60 ml, which is 1/12.5 of a 750 ml bottle.
- Perishables carry a received date and expiry; earliest expiry is issued first.
- Each item has a par level and a lower critical level.
- Physical counts are entered on a schedule; the gap to expected stock is reported as variance by item and cause.

Ledger movements: goods receipt (adds, updates cost); sale (deducts recipe quantities); transfer; wastage, spillage, breakage (with reason); complimentary or staff meal (with approver); count correction (approved by a manager).

An item's availability is the number of portions current stock can still make: the smallest value of stock ÷ recipe quantity across its ingredients.

| Status | Rule | What happens |
| --- | --- | --- |
| Healthy | Stock above reorder level | Nothing |
| Reorder | Stock at or below reorder level | Purchase suggestion raised |
| Low | Portions available at or below the low threshold | "Few left" badge; for beverages, the offer rule fires |
| Out | Zero portions | Item marked unavailable on every device at once |

### 6.8 Purchasing and receiving (diagram 2)

| Step | When | Who | What is recorded |
| --- | --- | --- | --- |
| Indent | Night, at a set cut-off time | System suggests. A manager approves, or it goes out automatically, as each customer sets | Item, quantity needed, vendor, last rate paid |
| Vendor order | Right after approval | Manager or system | One PDF per vendor, shared on WhatsApp or downloaded and printed |
| Gate check | 5:00 am, on delivery | Watchman | Per line: accepted, short or rejected, with reason and photo |
| Staff re-check | When staff arrive | Storekeeper or kitchen staff | Items spoiled, expired or unusable, with photos; weights and counts; the rate from the vendor's bill |
| Goods received note | After the re-check | Watchman and staff both confirm | Final accepted quantity, billed rate and amount payable per item |
| Payment | After the note reaches accounts | Accounts | Payment date, mode and reference |

- Suggested indent quantity = par level − stock on hand − quantity already on order, rounded up to the vendor's pack size.
- Items rejected at the gate leave with the delivery person. Items rejected later by staff go on a return note to the vendor and are deducted from the amount payable.
- Nothing enters stock or gets paid until both checks agree. The GRN carries only what both accepted.

Vendor rate list:

- Two parts, Food and Beverage.
- The day's rate comes from the vendor's bill that arrives with the delivery. Staff enter it per item during the re-check and attach a photo of the bill.
- Each billed rate is saved per vendor and item with its date, so the list is a running price history showing the last rate paid.
- Approving a GRN puts the accepted quantity into stock at the billed rate, re-costs every recipe using the item, and updates dish margins and menu order.
- A billed rate above the last rate paid by more than a set tolerance flags the note for a manager before accounts can pay.
- The PDF is shared from the manager's phone on WhatsApp, or downloaded and printed. Fully automatic sending would need a WhatsApp Business account and is treated as a later step.

### 6.9 Beverage offers based on stock

When a beverage runs low, the system puts a set percentage discount on similar beverages priced slightly above it, so guests switch to stock the outlet has plenty of. Food is never auto-discounted.

| Setting | Example value | Meaning |
| --- | --- | --- |
| Low-stock trigger | 5 serves or fewer (300 ml for a 60 ml peg) | When a beverage counts as low |
| Discount | 10% | The set percentage |
| Price band | 1% to 25% above the low item's price | "Higher, but not too high" |
| Match scope | Same beverage type and serve size | What counts as a substitute |
| Margin floor | 55% after discount | Never discounted below this |
| Substitute stock | 15 serves or more | Never promote something that is itself running low |
| Limit | 3 items per trigger | Keeps the menu readable |
| Mode | Automatic | Who switches it on |
| Release | Low item restocked above trigger plus a buffer, or end of day | When the offer ends |
| Applies to | Beverages only | Food order is set by margin alone |

How it runs:

1. A bill or spillage entry posts to the ledger; the beverage's serves-available figure updates.
2. If it reaches the trigger, a low-stock event is raised.
3. The pricing engine lists candidates: same type and serve size, price inside the band, enough stock.
4. It removes candidates whose discounted price would fall under the margin floor.
5. It ranks the rest by margin after discount and keeps the top few.
6. It creates time-boxed offer records. The guest menu and POS show the old price struck through and the offer price.
7. On restock or expiry the offers end. Each start and stop is logged with the item that triggered it.

Worked example (illustrative figures). Whisky A, 60 ml at ₹320, drops to 4 serves. Band ₹323 to ₹400, discount 10%, margin floor 55%.

| Candidate (60 ml) | Menu price (₹) | After 10% (₹) | Serve cost (₹) | Margin after discount | Result |
| --- | --- | --- | --- | --- | --- |
| Whisky B | 360 | 324 | 110 | 66% | On offer |
| Whisky C | 340 | 306 | 95 | 69% | On offer |
| Whisky D | 380 | 342 | 170 | 50% | Skipped, under the floor |

A ₹420 whisky is never considered because it is above the band.

Guardrails: a buffer between trigger and release stops flapping; offers apply to new bills only; the receipt shows menu price and offer as separate lines; a manager can exclude or pin any beverage; the dashboard compares sales before and during each offer; offers on alcohol have an owner-level switch per outlet because state rules differ.

### 6.10 Margins and menu ranking

| Figure | How it is worked out | Used for |
| --- | --- | --- |
| Portion cost (₹) | Sum of each ingredient's recipe quantity × current unit cost, adjusted for yield | Everything below |
| Margin (₹) | Selling price before tax − portion cost | Dashboard and reports |
| Margin % | Margin (₹) ÷ selling price before tax | Ranking key, target setting, margin floor |
| Suggested price (₹) | Portion cost ÷ (1 − target margin %) | Pricing a new or re-costed item |

- A target margin can be set per outlet, category or item; the most specific wins.
- Each dish's recipe is entered once. After that, every approved GRN re-costs it.
- An item whose margin falls below target by more than a tolerance is flagged with a suggested price. Menu prices change only after a manager approves.
- Menu ranking uses the latest billed purchase rate. Stock value in reports uses weighted average cost.

Ranking, run separately inside each course: available items first; sorted by margin %, highest first; ties broken by units sold in the last 30 days; a manager can pin an item. Beverages are not ranked by margin; they keep their type and brand order and show offers. The guest menu and the POS use the same order.

Side effect the user has been told about: a low-priced dish with a high margin % can rank above a dish that earns more rupees per plate. The dashboard shows both figures.

Worked example (illustrative). Tomato moves from ₹20 to ₹50 per kg. Tomato Soup uses 250 g, so its portion cost rises by ₹7.50.

| Item | Menu price (₹) | Cost before (₹) | Cost after (₹) | Margin before | Margin after | Position in Soups |
| --- | --- | --- | --- | --- | --- | --- |
| Tomato Soup | 160 | 38.00 | 45.50 | 76.3% | 71.6% | 1st to 2nd |
| Sweet Corn Soup | 160 | 42.00 | 42.00 | 73.8% | 73.8% | 2nd to 1st |

A monthly menu engineering report sorts items into four groups by margin and popularity. "High margin" means above the menu's average; "popular" means a sales share above (1 ÷ number of items) × 0.70. For the bar it shows pour cost (cost of liquor used ÷ liquor sales); bars typically aim for about 20%.

### 6.11 POS and dashboard

POS (billing only):

| Step | What the screen does |
| --- | --- |
| Open a bill | When the first order is given, pick a table or takeaway. Later orders are added to the same bill |
| Add items | Food lists each course by margin, highest first. Beverages list by type and brand, with offers marked |
| Stock check | Items that are out are greyed. Items running low show how many are left |
| Bill | Food and liquor totalled separately, each with its own tax. An offer shows as its own line |
| Payment | Cash, UPI, card or a split |
| Receipt | Printed or sent to the guest. Carries the FSSAI number and veg / non-veg marks |
| After payment | Stock is deducted per recipe and the sale reaches the dashboard |

- Margin figures are never shown on the POS. The cashier sees only the order of items.
- Time spent runs from the first order to payment, so the first order must be entered when it is given.
- Offline: bills are saved on the device and sent when the connection returns. While offline, sold-out marks and offers are as of the last sync, so an item can be billed after it has run out; the ledger shows the shortfall once the bills arrive.

Dashboard:

| Block | Shows | Worked out from |
| --- | --- | --- |
| Sales today | Sales, number of bills, average bill value, food and beverage split | Bills |
| Margins | Margin in ₹ and % by dish and course; dishes whose margin fell after a price change | Recipe cost, bill lines |
| Stock | Stock value for Food and for Beverage, low and out items, wastage, deliveries awaiting a GRN | Stock ledger, receiving |
| Demand by weekday and hour | Units sold in a weekday by hour grid, for any item or category | Time on each bill line |
| Top sellers | Top dishes, top drinks and top liquor brands, by units and by revenue | Bill lines |
| Food and alcohol sold | Totals in ₹, plates of food and litres of alcohol | Bill lines, serve sizes |
| Time spent | Average time from the first order on a bill to its payment, by time of day | First order time and payment time |
| Offers | Beverage offers running now and what they sold | Offer records |

Every block filters by date range, outlet, and Food or Beverage. The dashboard reads hourly and daily summary tables, not raw bills.

### 6.12 Multi-user design

| Role | Works in | Can change | Needs approval for |
| --- | --- | --- | --- |
| Owner / admin | All modules, all outlets | Users, roles, pricing rules, margin targets | Nothing |
| Outlet manager | Own outlet | Menu, prices, offers, nightly indent, stock corrections | Price changes beyond a set limit |
| Watchman | Receiving app, gate check only; sees quantities, not rates | Accept, short or reject each delivered line, with photos | Nothing; the staff re-check follows |
| Storekeeper / kitchen staff | Receiving app, inventory | Re-check, return notes, transfers, stock counts | Write-offs and count corrections |
| Chef / bar manager | Recipes, kitchen or bar stock | Recipes, wastage and spillage entries | Recipe changes that push margin under target |
| Cashier | POS | Bills, payments, receipts | Bill cancellation, refunds, manual discounts |
| Accounts | Goods received notes, vendor payments, reports | Payment status, exports | Paying a note held for a rate difference |

Roles are sets of permissions and can be reshaped without code changes.

- **Selling the last portion.** Each bill posts its stock deduction and balance update in one database transaction; if two POS counters bill the last portion together, one is told it just sold out.
- **Editing the same record.** Items, recipes and prices carry a version number.
- **Live updates.** Stock, sold-out status, prices and offers are pushed to every signed-in device.
- **Approvals.** Price changes, margin targets, rule changes and write-offs go to an approval queue.
- **Shared tablets.** Staff switch user with a short PIN.
- **Network drops.** The POS and the receiving app queue entries locally and send on reconnect.
- **Several outlets.** Every record belongs to an outlet and users are scoped to outlets.
- **Audit trail.** Every change records who, when, device, before and after. Ledger rows and bills are corrected only by a reversing entry.

### 6.13 Data model

| Table | Key fields | Purpose |
| --- | --- | --- |
| outlet | name, state, licence numbers | Boundary for stock, prices and users |
| user, role, permission | user ↔ role ↔ outlet | Access control |
| category | name, parent, kind (food course or liquor type) | Food courses; liquor type → sub-type tree |
| brand | name | Liquor and packaged goods |
| stock_item | name, department (Food or Beverage), category, brand, base unit, bottle size, reorder level, critical level | Ingredients and bottles |
| store | outlet, name | Main store, kitchen, bar |
| stock_ledger | stock item, store, quantity (+/−), unit cost, movement type, reference, user, time | Append-only history of every movement |
| stock_balance | stock item, store, quantity, average cost | Running balance |
| vendor, vendor_rate, indent, receipt_check, goods_received_note, vendor_payment | vendor, item, rate and date, ordered / accepted / rejected quantity, reason, photos, checker, amount payable | Purchasing and receiving |
| return_note | vendor, item, quantity, reason, photos | Items rejected after the delivery person has left |
| attachment | record it belongs to, photo, taken by, time | Photos from the gate check and re-check |
| menu_item | name, category, diet type, serve size, selling price, tax class, target margin, active | What guests order |
| recipe_line | menu item, stock item, quantity, yield % | Links menu items to stock |
| menu_item_cost | menu item, portion cost, margin ₹, margin %, calculated at | Re-costed when ingredient cost changes |
| price_rule | scope, trigger, discount %, price band, margin floor, limits, mode | Beverage offer rule settings |
| active_discount | menu item, rule, trigger item, discount %, start, end, status | Offers live right now |
| order, order_line | table, user, menu item, quantity, price charged, discount reference | Sales |
| bill, payment | opened and paid times, food total, liquor total, taxes, payment mode | Billing with the tax split |
| sales_hourly | outlet, date, hour, menu item, units, revenue, cost | Feeds the weekday-by-hour grid, top sellers, margins |
| sales_daily | outlet, date, department, bills, revenue, cost, litres of alcohol | Feeds sales today and the food and alcohol totals |
| approval_request | type, proposed change, proposer, approver, status | Two-person approval |
| audit_log | record, before, after, user, device, time | Change history |

Above all of this sits a customer record (the restaurant business), which decides which database a sign-in connects to.

### 6.14 Tech stack, jobs, hosting and privacy

Suggested stack (a suggestion; the modules and tables carry over to another stack):

| Layer | Suggested choice | Why |
| --- | --- | --- |
| Admin web app | React with TypeScript | Managers, storekeepers, accounts |
| POS and receiving app | Installable web app for tablets and phones, with an offline queue | No app-store release; works on any device |
| API | NestJS (Node, TypeScript), REST plus WebSocket | One language front and back |
| Database | PostgreSQL, one database per customer | Transactions and row locks for stock |
| Events, cache, jobs | Redis | Live pushes; background re-costing |
| Files | S3-compatible object storage | Menu photos, invoices, receiving photos |
| Sign-in | Password plus PIN on shared devices; role checks enforced in the API | The app never trusts the screen to hide things |
| Hosting | Containers in an India cloud region, managed PostgreSQL with daily backups | Low latency, local data storage |
| Integrations | Receipt printers, PDF orders to vendors, UPI and card payments, accounting export | Connects to what outlets already run |

What runs on its own:

| Job | When | What it does |
| --- | --- | --- |
| Nightly indent | At the cut-off time | Builds an indent per vendor, then waits for approval or sends, per the customer's setting |
| Vendor order | On approval | Generates one PDF per vendor |
| Delivery list | Before 5:00 am | Puts today's expected deliveries on the receiving app |
| Re-costing | When a GRN is approved | Updates ingredient cost, re-costs recipes, flags dishes under target |
| Menu re-rank | After re-costing, and when an item sells out or returns | Rebuilds the margin order inside each course |
| Offer engine | On every beverage stock movement | Starts an offer when a beverage runs low; ends it on restock or at day end |
| Dashboard roll-up | On every paid bill | Updates the hourly and daily summary tables |
| Day close | End of service | Closes the per-label liquor register; totals the day's sales and cash |
| Backup | Nightly | Copies each customer's database |

Hosting recommendation, awaiting the user's confirmation: one shared application with a separate database per customer, in an India cloud region.

| Option | How customers are kept apart | Privacy | Cost and upkeep | Verdict |
| --- | --- | --- | --- | --- |
| One shared database | A customer tag on every row | Weakest: one coding mistake can expose another restaurant's figures | Lowest | Not recommended |
| Shared application, database per customer | Own database and encryption key each | Strong: no query can cross customers; per-customer backup, export, deletion | Moderate | Recommended |
| Separate installation per customer | Own servers and database | Strongest | Highest | Only for large customers who insist |
| On the customer's own server | Held at their premises | Depends on their security | High support cost, slow updates | Not recommended |

Safeguards: sign-in identifies the customer first; encryption in transit and at rest; receiving photos in private per-customer storage; White Tusker support access only on the customer's approval, time-limited and logged; minimal personal data (staff names and phones, vendor contacts; the QR menu collects nothing about guests); per-customer export, deletion on leaving, and backups.

### 6.15 India compliance carried in the design

| Rule | What the source says | What the system does |
| --- | --- | --- |
| GST on food | Standalone restaurants charge 5% GST with no input tax credit; alcohol is outside GST and taxed under state excise and VAT (Sahi, updated 11 May 2026) | Every menu item has a tax class; the bill totals food and liquor separately |
| Mixed bills | Each bill line must be tagged food or liquor at source (Terra Insight) | Tax class is set on the item, not chosen at billing |
| Excise stock register | Licensed bars keep a daily register of opening stock, receipts, sales and closing stock per label, open to inspection (Terra Insight) | The ledger prints this register per label in bottle units |
| Veg and non-veg marks | Veg is a green circle in a green square; non-veg is a brown triangle in a brown square; anything with egg is non-veg; marks go on menu cards (Petpooja) | Diet type is a required field and prints on every menu and bill |
| FSSAI number | The 14-digit licence number must appear on every bill (Petpooja) | Stored per outlet, printed automatically |
| Allergens and calories | Allergens are listed beside the item; calorie values apply to a central licence or 10 or more outlets (FSSAI FAQ) | Allergen field on each item; optional calorie field |
| Liquor promotions | In July 2024 a Mangaluru bar was served notice for advertising a student discount on alcohol, cited as a breach of the Karnataka Excise Act, 1965 and its licence conditions (Deccan Herald) | Offers on alcohol have an owner-level switch per outlet |
| Personal data | India's Digital Personal Data Protection Rules were notified on 13 November 2025; they call for safeguards such as encryption, access controls, logging and backups, and a detailed breach report within 72 hours (Mondaq) | See the hosting safeguards |

## 7. Next piece of work, on hold: POS and dashboard screen designs

Do not start this until the user asks. When they do, first ask for White Tusker's logo and brand colours, which they said they will provide.

Planned screens:

1. **POS, new bill.** Table or takeaway picker; Food and Beverage tabs; food grouped by course in margin order; beverages by type and brand with offers marked; out items greyed, low items showing the number left; the running bill beside the items.
2. **POS, payment and receipt.** Food and liquor totals shown separately with their taxes; offer lines; cash, UPI, card, split; receipt preview with FSSAI number and veg / non-veg marks.
3. **Dashboard, overview.** Sales today, margins by course, dishes whose margin fell after a price change, stock value for Food and Beverage, low and out items, deliveries awaiting a GRN, offers running.
4. **Dashboard, demand and top sellers.** Weekday by hour grid, top dishes, top drinks, top liquor brands, food and alcohol totals, time spent.

Constraints to respect:

- The POS must work with touch and with mouse and keyboard, so touch targets of at least 44 px and no hover-only actions.
- The POS must show an offline state and unsent bills.
- No margin figures anywhere on the POS.
- Veg mark is a green circle in a green square; non-veg is a brown triangle in a brown square. Do not rely on colour alone.
- Any figures in mock-ups are sample data and must be labelled as such.
- The receiving app and guest QR menu were not requested as designs. Offer them; do not add them unasked.

## 8. Open points and cautions

Still open with the user:

1. Confirm the hosting recommendation.
2. Share White Tusker's logo and brand colours.
3. Confirm with a Karnataka excise consultant that automatic offers on alcohol are allowed under the bar licence.
4. Default cut-off time for the nightly indent.
5. WhatsApp: is a share button on the manager's phone enough, or must the PDF send itself?
6. How customers will pay for the product (per outlet per month, or another plan).

Cautions:

- The research found no published rule that plainly allows or bans in-house price discounts on liquor in Karnataka. Only Karnataka was checked. Do not tell the user it is permitted.
- The tax and data-protection points come from secondary sources, not the statutes. The user was advised to confirm them with a CA, an excise consultant and a lawyer.
- The data-protection rules phase in over time; the exact dates were not confirmed.
- All rupee figures in the worked examples are illustrative, not real prices or costs.
- The liquor brand list is a seed list from general knowledge, not from the user.
- The trigger, band, discount and margin-floor values are example settings, not values the user chose.
- The tech stack is a suggestion. The user has not said what stack White Tusker's developers use.

## 9. Sources

- GST on Food and Restaurants — Sahi, updated 11 May 2026: https://www.sahi.com/glossary/gst-on-food-and-restaurants
- Restaurant Liquor and Bar Sales Reconciliation in India — Terra Insight, 4 May 2026: https://www.terra-insight.com/insights/restaurant-liquor-bar-sales-reconciliation-india/
- FAQ on Display of Information in Food Service Establishments — FSSAI: https://fssai.gov.in/upload/uploadfiles/files/FAQ-%20Display%20of%20Information.pdf
- FSSAI Logo Rules Guide — Petpooja, 13 August 2026: https://blog.petpooja.com/finance-compliance/fssai-logo-rules-packaging-menu/
- The Menu Engineering Matrix — meez, updated 24 August 2026: https://www.getmeez.com/blog/menu-engineering-matrix
- Bar Inventory Management: The Complete How-To Guide — BinWise: https://home.binwise.com/guides/bar-inventory-management
- 10 Dynamic Pricing Strategies to Boost Restaurant Profits — OrderOut, 28 March 2026: https://www.orderout.co/blog/dynamic-pricing-strategies/
- Mangaluru bar offers discount to students; police serves notice — Deccan Herald, 26 July 2024: https://www.deccanherald.com/india/karnataka/mangaluru-bar-offers-discount-to-students-police-serves-notice-3124152
- Digital Personal Data Protection Rules, 2025 Notified — Mondaq: https://www.mondaq.com/india/data-protection/1708164/digital-personal-data-protection-rules-2025-notified
