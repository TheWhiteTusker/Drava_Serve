# Phase 3 summary: purchasing and receiving

## What now works

**Vendors and their rates.** Each vendor has a list of what they supply, in which unit ("kg", "bottle", "case of 12") and pack size. Every rate from a vendor's bill is kept, so you can see that tomato was ₹20 last week and ₹22 today. Rates are split into Food and Beverage.

**The nightly indent.** At each outlet's cut-off (11:00 pm by default), the system works out what to order: par level − stock on hand − what is already on order, rounded up to the vendor's pack size. Example: par 10 kg of tomato, 1 kg on hand, nothing on order → order 9 kg. If corn comes in 5 kg packs and you're 3 kg short, it orders 5 kg. It makes one order per vendor. Then it waits for a manager to approve, or approves itself if the business is set to "send automatically".

**Sending the order.** An approved order becomes a PDF. On the manager's phone, **Share** opens the phone's share sheet, so it goes to the vendor on WhatsApp in two taps. **Download** and **Print** work too. Every attempt is recorded: who, when, how, and whether it worked. When White Tusker sets up WhatsApp Business, automatic sending can be added without changing any of this.

**Receiving app** (on a phone, at `/receiving/`):
- Before 5:00 am, the watchman sees today's expected deliveries.
- **Gate check:** one item at a time with big buttons: Accept, Short (type how much came) or Reject (pick a reason), plus a photo button. The watchman never sees prices.
- **Staff re-check:** usable quantity, anything spoiled, expired or unusable (with a reason and photo), the weighed amount, expiry date, and the rate from the vendor's bill, plus a photo of the bill.
- **Return note:** anything staff reject after the delivery person has gone goes on a return note and is taken off what you owe the vendor.
- **Goods received note:** the watchman and the staff member both sign it. Only then do the accepted items enter stock, at the billed rate.
- **No signal?** The app keeps working, saves everything on the phone, and sends it when it reconnects.

**Rate rise check.** If a billed rate is more than 10% (adjustable) above the last rate paid, the note is held. Accounts can't pay it until a manager approves. Example: tomato billed at ₹50 a kg when the last rate was ₹22.

**Accounts.** Notes waiting for payment, held notes, notes awaiting signatures and paid notes. Record the payment date, mode and reference, and export to CSV.

**What happens automatically after a delivery:** the new rate becomes the item's cost, and every dish using it is re-costed and re-ranked (see the Phase 4 summary).

## Try it yourself

1. Start the apps ([README › Run](../README.md#run)), then open http://localhost:5173.
2. **On a phone or a narrow browser window,** open http://localhost:5174/receiving/ and sign in as `watchman@demo.test` / `Demo@1234`. Today's vegetable delivery for Indiranagar is waiting. Accept some lines, mark one Short and reject one with a reason. Take a photo if you're on a phone. Press **Finish gate check**.
3. Sign out and sign in as `store@demo.test`. Open the same delivery, enter a usable quantity and the bill rate for each line (try rejecting a little as Spoiled), add a bill number, and press **Finish re-check**. Then press **Sign as staff**.
4. Sign in again as the watchman and press **Sign as watchman**. The stock goes in.
5. On a computer, as `owner@demo.test`: **Purchasing → Deliveries** shows the note, **Accounts** lets you record a payment and export CSV, and **Vendors and rates → Rate history** shows the new rate.
6. **Purchasing → Nightly indent:** pick tomorrow's date, press **Build now**, open an order, change a quantity, **Approve**, then try **Share** (on a phone), **Download** or **Print**. Each attempt appears under "Sent".
7. To see a held note: in step 3, enter a rate far above the last one (for example ₹100 a kg for tomato). After both signatures, the note shows as held. Release it in **Business → Approvals** as `manager@demo.test`.

## What I assumed

See the Phase 3 section of [DECISIONS.md](DECISIONS.md). The ones to look at:
- The vendor's bill includes items staff rejected later, so those are deducted as a return. Items rejected at the gate are not on the bill.
- The vendor PDF shows items and quantities, not prices.
- A vendor turning up with no order (an unplanned delivery) isn't handled yet.

## What I need from you

- **Should the vendor PDF show prices** (the last rate paid)? I left them off.
- **Unplanned deliveries:** do you want staff to be able to receive goods that weren't ordered?
