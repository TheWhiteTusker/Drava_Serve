import { useState } from 'react';
import { dec } from '@fnb/shared';
import { Banknote, CreditCard, Smartphone, Split } from 'lucide-react';
import { rupee, rupeeShort } from '../lib/ui';
import type { LocalBill } from './types';
import { Dialog } from './dialog';

export function PayDialog({ total, onPay, onClose }: { total: string; onPay: (p: { mode: string; amount: string; reference?: string }[]) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'cash' | 'upi' | 'card' | 'split'>('cash');
  const [tendered, setTendered] = useState('');
  const [split, setSplit] = useState({ cash: '', upi: '', card: '' });
  const splitSum = dec(split.cash || 0).plus(split.upi || 0).plus(split.card || 0);
  const change = tendered ? dec(tendered).minus(total) : null;
  const ok = mode === 'split' ? splitSum.eq(total) : mode !== 'cash' || !tendered || dec(tendered).gte(total);
  function confirm() {
    if (mode === 'split') onPay((['cash', 'upi', 'card'] as const).filter((k) => split[k] && dec(split[k]).gt(0)).map((k) => ({ mode: k, amount: dec(split[k]).toFixed(2) })));
    else onPay([{ mode, amount: dec(total).toFixed(2) }]);
  }
  return (
    <Dialog title={`Pay ${rupee(total)}`} onClose={onClose}>
      <div className="pay-modes">
        {(
          [
            ['cash', 'Cash', Banknote],
            ['upi', 'UPI', Smartphone],
            ['card', 'Card', CreditCard],
            ['split', 'Split', Split],
          ] as const
        ).map(([m, label, Icon]) => (
          <button key={m} className={`pay-mode ${mode === m ? 'on' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
            <Icon className="icon" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      {mode === 'cash' && (
        <div className="stack" style={{ marginTop: '1rem' }}>
          <label className="field">
            Cash received (optional)
            <input inputMode="decimal" autoFocus value={tendered} onChange={(e) => setTendered(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && confirm()} />
          </label>
          <div className="quick-cash">
            {[...new Set([Math.ceil(Number(total)), Math.ceil(Number(total) / 100) * 100, Math.ceil(Number(total) / 500) * 500, Math.ceil(Number(total) / 2000) * 2000])].map((v) => (
              <button key={v} className="secondary" onClick={() => setTendered(String(v))}>
                {v === Math.ceil(Number(total)) ? 'Exact' : rupeeShort(v)}
              </button>
            ))}
          </div>
          {change && change.gte(0) && (
            <div className="change">
              <span>Give back</span>
              <strong>{rupee(change.toString())}</strong>
            </div>
          )}
        </div>
      )}
      {mode === 'split' && (
        <div className="stack" style={{ marginTop: '0.75rem' }}>
          {(['cash', 'upi', 'card'] as const).map((k) => (
            <label key={k} className="field">
              {k === 'upi' ? 'UPI' : k[0].toUpperCase() + k.slice(1)}
              <input inputMode="decimal" value={split[k]} onChange={(e) => setSplit({ ...split, [k]: e.target.value })} />
            </label>
          ))}
          <p className={splitSum.eq(total) ? '' : 'note danger'}>
            {rupee(splitSum.toString())} of {rupee(total)}
          </p>
        </div>
      )}
      <button className="huge gold" disabled={!ok} onClick={confirm} style={{ width: '100%', marginTop: '1rem' }}>
        Confirm {mode === 'split' ? 'split payment' : `${mode === 'upi' ? 'UPI' : mode} payment`}
      </button>
    </Dialog>
  );
}

export function MoreDialog({ bill, onRequest, onClose }: { bill: LocalBill; onRequest: (k: 'cancel' | 'discount' | 'void', extra: Record<string, string>) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [pct, setPct] = useState('');
  const [line, setLine] = useState('');
  return (
    <Dialog title="Needs a manager's approval" onClose={onClose}>
      <div className="stack">
        <label className="field">
          Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="row">
          <label className="field" style={{ flex: 2 }}>
            Discount %
            <input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
          </label>
          <button disabled={!pct || reason.length < 3} onClick={() => onRequest('discount', { discountPct: pct, reason })}>
            Ask for discount
          </button>
        </div>
        <div className="row">
          <select aria-label="Item to remove" value={line} onChange={(e) => setLine(e.target.value)} style={{ flex: 2 }}>
            <option value="">Item to remove…</option>
            {bill.lines
              .filter((l) => l.id && l.status !== 'voided')
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} × {dec(l.qty).toString()}
                </option>
              ))}
          </select>
          <button disabled={!line || reason.length < 3} onClick={() => onRequest('void', { lineId: line, reason })}>
            Ask to remove
          </button>
        </div>
        <button className="bad" disabled={reason.length < 3} onClick={() => onRequest('cancel', { reason })}>
          Ask to cancel the whole bill
        </button>
      </div>
    </Dialog>
  );
}
