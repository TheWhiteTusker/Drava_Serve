import { eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { dec } from '@fnb/shared';
import { findOr404 } from '../common.js';
import { tenantSchema as t, type Q } from '../db/index.js';

// ---------- The vendor order PDF ----------

export async function indentPdf(q: Q, indentId: string) {
  const indent = await findOr404(q.select().from(t.indent).where(eq(t.indent.id, indentId)));
  const vendor = await findOr404(q.select().from(t.vendor).where(eq(t.vendor.id, indent.vendorId)));
  const outlet = await findOr404(q.select().from(t.outlet).where(eq(t.outlet.id, indent.outletId)));
  const lines = await q
    .select({ l: t.indentLine, name: t.stockItem.name, unit: t.stockItemUnit.name, baseUnit: t.stockItem.baseUnit })
    .from(t.indentLine)
    .innerJoin(t.stockItem, eq(t.stockItem.id, t.indentLine.stockItemId))
    .leftJoin(t.stockItemUnit, eq(t.stockItemUnit.id, t.indentLine.unitId))
    .where(eq(t.indentLine.indentId, indentId))
    .orderBy(t.stockItem.name);

  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const number = `PO-${outlet.code}-${indent.forDate.replaceAll('-', '')}-${indent.id.slice(0, 4).toUpperCase()}`;
  doc.fontSize(18).text('Purchase order', { continued: false });
  doc.moveDown(0.3).fontSize(10).fillColor('#444').text(number);
  doc.moveDown();
  doc.fillColor('#000').fontSize(11).text(`From: ${outlet.name}`);
  if (outlet.address) doc.text(outlet.address);
  if (outlet.gstin) doc.text(`GSTIN: ${outlet.gstin}`);
  doc.moveDown(0.5).text(`To: ${vendor.name}`);
  if (vendor.phone) doc.text(vendor.phone);
  doc.moveDown(0.5).text(`Deliver on: ${indent.forDate}, by 5:00 am`);
  doc.moveDown();
  const x = { item: 48, qty: 360, unit: 430 };
  const header = doc.y;
  doc.font('Helvetica-Bold').text('Item', x.item, header).text('Quantity', x.qty, header).text('Unit', x.unit, header);
  doc.font('Helvetica').moveTo(48, doc.y + 4).lineTo(547, doc.y + 4).stroke();
  doc.moveDown(0.6);
  for (const { l, name, unit, baseUnit } of lines) {
    const qty = l.approvedQty ?? l.suggestedQty;
    if (dec(qty).lte(0)) continue;
    const y = doc.y;
    doc.text(name, x.item, y, { width: 300 }).text(dec(qty).toString(), x.qty, y).text(unit ?? baseUnit, x.unit, y);
    doc.moveDown(0.4);
  }
  doc.moveDown(2).fontSize(9).fillColor('#666').text('Please send your bill with the delivery. Items not fresh or not as ordered will be returned at the gate.', 48);
  doc.end();
  return { indent, vendor, outlet, pdf: await done, number };
}
