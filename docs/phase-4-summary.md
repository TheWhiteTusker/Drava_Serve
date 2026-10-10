# Phase 4 summary: costing, menu ranking and beverage offers

## What now works

**Recipes and portion cost.** Each dish's recipe is entered once: ingredients in grams, ml or pieces, with a yield % for trimming and cooking loss. One bottle sells as several items (30 ml, 60 ml, bottle; glass and bottle for wine), each with its own recipe line. Cocktails are recipes too (Cuba Libre = 60 ml rum + 150 ml cola + half a lemon). The recipe screen shows the cost and margin as you type.

**Re-costing after every delivery.** When a goods received note goes into stock, the new rate becomes the ingredient's cost, every dish using it is re-costed, and its margin in ₹ and % is recalculated. If a dish falls under its target margin, it is flagged with a suggested price (cost ÷ (1 − target)). That goes to the approval queue, and the price changes only when a manager approves.

**Your worked example works.** Tomato goes from ₹20 to ₹50 a kg. Tomato Soup's cost rises from ₹38.00 to ₹45.50 and its margin falls from 76.25% to 71.56%, below Sweet Corn Soup's 73.75%, so Sweet Corn Soup moves to first place in Soups. With a 75% target, Tomato Soup is flagged with a suggested price of ₹182. Once a manager approves, it goes back to first place.

**Targets.** Set a target margin for the whole outlet, a course, or a single dish. The most specific one wins.

**Menu order inside each course:** dishes in stock come first, then the highest margin %, ties broken by sales in the last 30 days. A manager can pin a dish to the top. A sold-out dish drops to the end straight away and moves back up when it's restocked. Beverages stay in type and brand order.

**Price controls.** A manager's price change of more than 10% (adjustable) goes for approval. A chef's recipe change that pushes a dish under target also needs approval.

**Beverage offers**, following your example. Whisky A (₹320) drops to 4 serves. The engine looks at whiskies of the same serve size priced 1% to 25% above it. Whisky B (₹360 → ₹324) and Whisky C (₹340 → ₹306) go on offer. Whisky D would fall under the 55% margin floor, so it's skipped, and a ₹420 whisky is outside the band. Offers end when Whisky A is restocked, at the start of the next business day, or when the owner switches them off. Every start and stop is logged with the item that triggered it. All the settings are editable on the Beverage offers screen.

**Silent price change.** Guests and the POS see only the new lower price. There is no "offer" tag and no crossed-out price, and the bill will show only the price charged. Behind the scenes, everything is recorded for your reports: menu price, price charged and which offer caused it.

**Guest QR menu.** At `/m/<business>/<outlet>`, for example http://localhost:5173/m/demo/BLR1. Food is grouped by course in ranked order, drinks by type and brand. It shows veg and non-veg marks (by shape, not just colour), allergens, sold-out items greyed and current prices only. There's no sign-in, no cookies and nothing collected about guests. **Outlets → QR code** gives a printable QR for each outlet.

**Margins never leave the admin screens.** The POS and the guest menu receive no cost or margin figures at all, and a test checks this.

## Try it yourself

1. Sign in as `owner@demo.test`. Open **Pricing → Menu costs and order**. Soups shows Tomato Soup above Sweet Corn Soup (76.22% vs 74.22% in the sample data).
2. Click **Recipe** on Tomato Soup and change the tomato quantity to 600 g. The cost and margin update as you type. Close without saving.
3. Make tomato expensive: receive tomato at ₹50 a kg through the receiving app (Phase 3 summary, steps 2–4). Then come back: Sweet Corn Soup is now first.
4. **Pricing → Margin targets:** set Soups and salads to 75%. Tomato Soup is flagged "under target" with a suggested price. Approve it in **Business → Approvals** as `manager@demo.test`.
5. **Pricing → Beverage offers:** Royal Stag is down to 4 pegs at Indiranagar, so Blenders Pride 60 ml is on offer at ₹306 instead of ₹340. Open http://localhost:5173/m/demo/BLR1 on your phone, tap Drinks, and Blenders Pride shows ₹306 with no offer label.
6. Switch to the Mysuru outlet: offers are off there (**Settings → Beverage offers**), so no offer is running.

## What I assumed

See the Phase 4 section of [DECISIONS.md](DECISIONS.md). The ones to look at:
- Suggested prices are rounded up to the next whole rupee.
- The guest menu greys out sold-out items rather than hiding them, and says "Prices are before taxes".
- Offers end at the start of the next business day (5:00 am by default).

## What I need from you

- **Guest menu:** should sold-out items be hidden instead of greyed?
- The **excise consultant check** on automatic liquor offers is still needed before switching them on for a real outlet.
