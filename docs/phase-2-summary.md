# Phase 2 summary: inventory ledger

## What now works

**Every stock movement is a line in a ledger that can't be edited.** A goods receipt, sale, transfer, wastage, spillage, breakage, complimentary item, staff meal or count correction each adds a line. Stock on hand is the total of those lines. A mistake is fixed with a "reverse" line, never by editing. Example: the chef records 30 ml of Royal Stag spilled by mistake, the manager presses Reverse, and both lines stay in the history.

**Three stores per outlet.** Each outlet has a main store, a kitchen and a bar. Transfers move stock between them at the same cost and keep expiry dates. Sales draw from the kitchen (food) or the bar (drinks).

**Cost.** Each item keeps a running weighted average cost. If 10 kg of tomato came in at ₹20 and another 10 kg at ₹50, the average is ₹35 a kg. Stock value on screen uses this average.

**Expiry.** Perishables carry an expiry date, and the oldest-expiring stock is always used first.

**Status at a glance.** Every item shows Healthy, Reorder, Critical or Out against its par, reorder and critical levels. Every dish shows how many portions current stock can still make, for example "Tomato Soup: 4 left". A dish is marked out the moment any ingredient runs out.

**Approvals.** A storekeeper's wastage, any complimentary item or staff meal, and anyone's stock-count correction go to the approval queue. Chefs, bar managers and managers can record wastage and spillage directly. Nobody can approve their own request.

**Stock counts.** Schedule a count for a store and date. When counting starts, the sheet shows what the books say. Staff enter what's actually on the shelf with a cause ("trimming", "theft"), and the gap shows as variance in quantity and rupees. The correction posts once a manager approves.

**Live updates.** When stock changes, every signed-in screen at that outlet updates within a second, including sold-out marks.

**Daily liquor register** per label: opening, receipts, sales, other movements and closing, in bottles and ml, printable for a chosen business day.

**Two counters, one last portion.** Stock is locked while it is being deducted. If two counters try to take the last 240 ml of a whisky at the same moment, one succeeds and the other is told there isn't enough. A test proves this.

## Try it yourself

1. `docker compose up --build`, then open http://localhost:5173 and sign in as `owner@demo.test` / `Demo@1234`.
2. **Inventory → Stock.** Switch between Food and Beverage. Some sample items show Reorder or Critical. Click an item name to see its movements: the sample week's sales are there.
3. **Record wastage** (button at the top right). Record 100 g of Tomato wasted from the Kitchen with a reason. As the owner it applies straight away, and the screen updates.
4. **Try the approval queue:** sign out, sign in as `store@demo.test` and record wastage. It says it has gone for approval. Sign in as `manager@demo.test`, open **Business → Approvals** and approve it.
5. **Transfer** 1 kg of Paneer from Main store to Kitchen. Main store has none in the sample data, so you'll see "Not enough Paneer in Main store". Then transfer from Kitchen to Main store instead.
6. **Inventory → Stock counts:** schedule a count for the Bar for today, open it, start counting, enter a different quantity for one bottle with a cause, save and submit.
7. **Inventory → Liquor register:** pick a date in the sample week and press Print.
8. **Live updates:** open the Stock screen in two browser windows, record wastage in one, and watch the other change.

## What I assumed

See the Phase 2 section of [DECISIONS.md](DECISIONS.md). The main ones:
- Sales draw from the kitchen (food) and the bar (drinks), so stock in the main store must be transferred before it counts as sellable.
- A business day runs from 5:00 am to 5:00 am, so late-night bar sales belong to the evening before. You can change this in Settings.
- Opening stock for a new customer is entered as a first stock count.

## What I need from you

Nothing new to continue. The liquor register format still needs checking by an excise consultant before go-live.
