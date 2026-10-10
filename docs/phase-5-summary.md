# Phase 5 summary: billing POS with offline queue

## What now works

**A POS for the counter** at `/pos/`. It can be installed on a tablet or desktop and works with touch, a mouse or a keyboard. Buttons are large enough for fingers, and the common actions have keys: F2 new bill, `/` search, Enter adds the first match, F9 send order, F8 pay, F4 open bills, F1 shows them all.

**New bill.** Pick a table or takeaway. Food and Beverage tabs show food by course in the ranked order, and drinks by type and brand. Sold-out items are greyed and can't be tapped. Items running low show how many are left ("4 left"). The running bill sits alongside, with food and liquor totalled separately and each with its own taxes.

**A bill opens at the first order.** Later orders go on the same bill, so the time spent at a table runs from the first order to payment.

**Last portion.** If two counters try to sell the last Tomato Soup at the same moment, one gets it and the other sees "Just sold out: Tomato Soup (0 left)".

**Payment** by cash (with change worked out), UPI, card, or a split. After payment, stock is deducted per recipe in one go, and the sale reaches the dashboard straight away.

**Receipt.** Print it or send it from the device's share sheet. It shows the outlet, GSTIN, FSSAI number, bill number, table, cashier, each item with its veg or non-veg mark (by shape), food and liquor totals each with their own taxes, round off, total and how it was paid. It shows only the price charged: a whisky on offer just shows its lower price, with no offer line. The layout fits 80 mm thermal printers.

**No internet? Keep billing.** The POS shows a clear OFFLINE badge and the number of unsent bills. Bills are saved on the tablet and sent, in order and exactly once, when the connection returns. While offline, prices and sold-out marks are as of the last sync. If something sold offline had actually run out, the stock ledger records the shortfall instead of rejecting the bill.

**Needs a manager:** cancelling a bill, removing an item already sent, a refund, or a manual discount. The cashier asks; a manager approves in the POS (Approvals button) or in the admin app. Cancelling a paid bill puts its stock back.

**Day close.** Totals the day's sales, taxes and payments by mode, compares the cash counted with what should be in the drawer, closes the day's liquor register and ends that day's offers. It won't close while any bill from that day is still open.

**Switch user** with a PIN, as in the admin app.

## Try it yourself

1. `docker compose up --build`, then open http://localhost:5173/pos/ (on a tablet or a wide browser window). Sign in as `cashier@demo.test` / `Demo@1234`.
2. Press **F2** (or tap New bill), pick a table, tap a few dishes and drinks, then press **Send order (F9)**. Blenders Pride 60 ml shows ₹306: it's on offer because Royal Stag is low, but nothing says so.
3. Press **Pay (F8)**, choose Cash, type the amount received to see the change, and confirm. The receipt appears. Try **Print**.
4. **Offline test:** turn off Wi-Fi (or, in the browser's developer tools, set the network to Offline). Start another bill, send it and pay it. The OFFLINE badge and "1 unsent bill" appear. Turn the connection back on: within a few seconds the badge clears, and the bill appears in the admin app.
5. **Approvals:** on an open bill, tap "Discount, remove item or cancel…", ask for a 10% discount with a reason, then press **Switch**, choose Asha (manager, PIN 2222), open **Approvals** and approve it. The total updates.
6. **Day close:** as Asha, press **Day close**, enter the cash counted and close the day.

## What I assumed

See the Phase 5 section of [DECISIONS.md](DECISIONS.md). The ones to look at:
- Bill numbers come from the tablet so they work offline (for example `BLR1-261010-6F001`). **A CA must confirm this meets GST invoice-series rules.**
- A manual discount is a percentage of the bill and does appear on the receipt as "Discount". Only the automatic beverage offers are silent.
- "Send to the guest" uses the device's share sheet, so no guest phone number or email is collected.

## What I need from you

- **Bill numbering:** please have your CA confirm one series per device is acceptable, or tell me the format you need.
- **Receipt printers:** which models will your customers use? Printing currently goes through the print dialog; a direct printer connection can be added in one place.
