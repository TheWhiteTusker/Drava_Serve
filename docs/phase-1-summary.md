# Phase 1 summary: foundation and data model

## What now works

**Each restaurant business gets its own database.** When White Tusker adds a customer, the system creates a separate database for it, sets it up, and loads a starting catalog: the eight food courses, the liquor tree from the handoff (Whisky → Indian → Royal Stag → Royal Stag 750 ml, and so on), a starter brand list, two tax classes and the seven staff roles. A small central list records only which customer uses which database and which sign-in belongs to which customer. Restaurant A's menu, stock and bills sit in A's database, and nothing the app does can read them while serving restaurant B.

**Sign-in.** Each person signs in with their email or phone and a password. On a shared tablet, someone else can take over with a short PIN: tap your name, type your PIN. Five wrong tries lock that person out for 15 minutes.

**Roles and outlets.** The seven roles from the handoff (Owner, Outlet manager, Watchman, Storekeeper, Chef / bar manager, Cashier, Accounts) are ready to use, and you can reshape them on screen by ticking permissions. A person can hold different roles at different outlets. For example, Asha is Outlet manager at Indiranagar only, so she cannot see or change the Mysuru menu. These rules are checked by the server on every request, not just hidden on screen.

**Change history.** Every change records who made it, when, on which device, and the values before and after. For example: "Asha changed Tomato Soup's price from ₹160 to ₹170 on tablet 3 at 4:12 pm". Nobody can edit or delete the history. Stock movements can never be edited either: a mistake is fixed with a correcting entry (this matters from phase 2).

**Two people editing the same thing.** If two managers open Tomato Soup at the same time and both save, the second one is told "Someone else changed this record after you opened it. Reload and try again", rather than silently overwriting the first.

**Admin screens:**
- Outlets: name, address, GSTIN, FSSAI number (checked to be 14 digits) and excise licence. Each new outlet automatically gets a main store, a kitchen store and a bar store.
- Users and roles.
- Settings: nightly indent cut-off (11:00 pm by default, can differ per outlet), approve-or-auto-send for the indent, tolerances, and the owner's per-outlet switch for beverage offers.
- Menu items, split into Food and Beverage. Food items show the veg mark (green circle in a green square) or non-veg mark (brown triangle in a brown square), and can't be saved without one. Each item also carries its course, allergens, tags, tax class and price before tax.
- Stock items: base unit (grams, ml or pieces), how vendors sell it ("25 kg bag = 25000 g", "case of 12 = 9000 ml") and par, reorder and critical levels for each outlet. Liquor products also carry bottle size, alcohol %, Indian-made or imported, and price tier.
- Liquor tree, courses and categories, brands, tax classes.
- Change history.
- Light and dark mode. All colours, fonts, corner rounding and the logo come from one file (`packages/theme/theme.css` plus the logo files next to it), so White Tusker's brand can be dropped in later by editing just that file.

**Sample data** (clearly labelled "sample" everywhere): one demo business with two Karnataka outlets (Indiranagar, Bengaluru and Mysuru), five vendors, 33 stock items, 30 menu items with recipes at each outlet, and a week of bills (346 in total). Tomato Soup and Sweet Corn Soup are set up like the handoff's worked example: both ₹160, costing about ₹38 and ₹41. When the costing engine arrives in phase 4, raising tomato from ₹20 to ₹50 a kg should swap their order.

## Try it yourself

1. Install and open Docker Desktop.
2. In a terminal, in the project folder, run: `docker compose up --build`. The first time takes a few minutes.
3. Open http://localhost:5173 in your browser.
4. Sign in with one of the sample accounts below. The password for all of them is `Demo@1234`.

| Sign in as | Role | Where | PIN |
| --- | --- | --- | --- |
| owner@demo.test | Owner / admin | All outlets | 1111 |
| manager@demo.test | Outlet manager | Indiranagar | 2222 |
| watchman@demo.test | Watchman | Indiranagar | 3333 |
| store@demo.test | Storekeeper / kitchen staff | Indiranagar | 4444 |
| chef@demo.test | Chef / bar manager | Indiranagar | 5555 |
| cashier@demo.test | Cashier | Indiranagar | 6666 |
| accounts@demo.test | Accounts | All outlets | 7777 |

Things to try:
- **Permissions:** sign in as the owner, open Menu items, then click "Switch" at the top and choose Vinay (Cashier) with PIN 6666. The menu disappears, because a cashier can't open the catalog. Switch back to Owner with 1111.
- **Outlet scoping:** sign in as manager@demo.test. Only Indiranagar is listed, and the Mysuru menu is out of reach.
- **Change history:** as the owner, change a dish's price, then open Change history to see the before and after, who made the change and on which device.
- **Overwrite protection:** open the same dish in two browser tabs, save a change in one, then try to save in the other.
- **Per-outlet cut-off:** in Settings, set the business cut-off to 22:30, then switch the outlet at the top and give Mysuru 23:15.
- **Dark mode:** click "Theme" at the top to cycle between following the device, light and dark.

To start over with fresh sample data: `docker compose down -v`, then `docker compose up --build` again.

## What I assumed

The full list, with reasons, is in [DECISIONS.md](DECISIONS.md). The ones you may want to look at:

- **Menu prices are before tax**, and GST or liquor tax is added on the bill, with the total rounded to the nearest rupee. Most Indian restaurants work this way, but it changes what guests see, so please confirm.
- **The liquor tax rate is set to 0% and labelled "rate not set (confirm with CA)"** rather than guessed. Food GST is 5% as the handoff says. Both can be edited on the Tax classes screen.
- **A sign-in (email or phone) belongs to one business only**, so staff don't need to type a business code. Someone working for two of your customers would need two sign-ins.
- **Ingredients are shared across a business's outlets; menus and prices are per outlet.** A tomato is the same tomato everywhere, but Indiranagar and Mysuru can have different dishes, prices and stock levels.
- **Mocktails and soft drinks** sit under the food course "Soft beverages" with food tax. **Cocktails** are a beverage type with liquor tax.
- **Beverage offers are switched off for every new outlet.** The owner turns them on per outlet. In the sample data they are on at Indiranagar only.
- **Local file storage:** MinIO (the usual local S3 store) no longer publishes its Docker image, so SeaweedFS is used locally. Production can use any S3-compatible storage in an India region.

## What I need from you

1. **Prices shown before or including tax?** I built "before tax, tax added on the bill". Tell me if your customers' menus show tax-inclusive prices.
2. **White Tusker logo and brand colours**, whenever ready. They go into `packages/theme/` only.
3. **CA, excise consultant and lawyer checks** listed at the top of DECISIONS.md. These aren't needed to continue building, but they are needed before any customer goes live.

When you're ready, reply **"go to phase 2"** (inventory ledger), or tell me what to change.
