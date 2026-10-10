// Receipt printing. Today: the browser's print dialog with an 80 mm thermal-friendly layout
// (works with any printer the tablet or PC can see). To print straight to a receipt printer
// (ESC/POS over USB, Bluetooth or network), replace printReceipt with a driver that takes the
// same receipt element; nothing else in the POS needs to change.

const THERMAL_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.35 ui-monospace, 'Cascadia Mono', Consolas, monospace; color: #000; background: #fff; width: 74mm; }
  h1 { font-size: 14px; margin: 0; text-align: center; }
  p { margin: 0; }
  .center { text-align: center; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .row > span:first-child { flex: 1; }
  hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  .total { font-weight: 700; font-size: 14px; }
  .mark { vertical-align: -2px; margin-right: 3px; }
  .muted { color: #000; }
`;

export function printReceipt(receipt: HTMLElement) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${THERMAL_CSS}</style></head><body>${receipt.outerHTML}</body></html>`);
  doc.close();
  frame.contentWindow!.focus();
  setTimeout(() => {
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  }, 100);
}
