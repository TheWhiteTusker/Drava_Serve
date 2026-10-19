# Phase 6 summary: dashboard and reports

## What now works

**The dashboard** (the first screen for owners and managers) shows:
- **Sales:** sales before tax, number of bills, average bill, and the split between food and beverage.
- **Food and alcohol sold:** plates of food and litres of alcohol.
- **Stock value right now** for Food and for Beverage, and **wastage** in the period.
- **Margin by course or drink type**, and **margin by dish** in both ₹ and %, so a cheap dish with a high % doesn't hide one that earns more rupees.
- **Margins that fell after a price change**, for example tomato going from ₹20 to ₹50.
- **Low and out items** right now, and **deliveries still waiting for a goods received note**.
- **Demand by weekday and hour:** a grid where darker means busier, for everything, a course or type, or a single dish. It can also be viewed as a table.
- **Top dishes and top drinks** (by units or revenue), and **top liquor brands**.
- **Average time from first order to payment** by hour of the day.
- **Beverage offers:** running now, menu price against price charged, and what each offer sold during the offer compared with the same length of time before it.

Every block follows the same filters: date range (Today, Last 7 days, Last 30 days, This month, or any dates), outlet (one or all of yours), and Food, Beverage or both. The dashboard updates live as bills are paid.

**It's fast because it reads summaries.** Every paid bill adds itself to hourly and daily summary tables in the same step that takes the payment. The dashboard reads those, never the raw bills. A cancelled bill takes itself back out.

**Reports:**
- **Monthly menu engineering:** every dish sorted into Star (high margin, popular), Plowhorse (popular, low margin), Puzzle (high margin, not popular) and Dog (neither), using the handoff's rules.
- **Bar pour cost:** cost of liquor sold ÷ liquor sales. Bars usually aim for about 20%; the sample data shows 32%.
- **Day-close totals, stock variance from counts, and the liquor register,** each exportable to CSV.

**Looking after the data:**
- **Nightly backup** at 2:00 am of each business's database, kept for 30 days.
- **Restore** a business from any of those backups with one command.
- **Export:** the owner can download all of their business data as a zip of spreadsheets (Reports → Download everything).
- **Delete:** when a business leaves, one command takes a final backup and then removes its database, files and sign-ins.

## Try it yourself

1. Start the apps ([README › Run](../README.md#run)), then open http://localhost:5173 and sign in as `owner@demo.test` / `Demo@1234`. The dashboard opens first.
2. Change the date range, switch between outlets, and choose Food or Beverage. Every block follows.
3. In **Demand by weekday and hour**, pick "Tomato Soup" to see when it sells. Hover over a square (or tab to it) for the exact number.
4. Ring up a bill on the POS in another window and watch Sales and Bills change.
5. **Reports:** look at menu engineering for this month, close a day on the POS, then export the day-close CSV.
6. **Backups** (for White Tusker's team, in a terminal): `pnpm --filter @fnb/api cli backup demo`, then `pnpm --filter @fnb/api cli backups demo` to list them. `pnpm --filter @fnb/api cli restore demo` restores the latest. Needs the PostgreSQL client tools and the `S3_*` settings.

## What I assumed

See the Phase 6 section of [DECISIONS.md](DECISIONS.md). The ones to look at:
- Dashboard sales are before tax and after approved discounts.
- "Litres of alcohol" means the volume of liquor served, not pure alcohol content.
- Restoring and deleting a business are done by White Tusker staff from the command line, not from a button in the app.

## What I need from you

- **How long should backups be kept?** It's 30 days now, and easy to change.
- **The lawyer's view** on data retention after a customer leaves (DPDP Rules). Deletion is currently immediate after a final backup, and that final backup stays in backup storage until someone removes it.
