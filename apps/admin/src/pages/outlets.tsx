import { useState } from 'react';
import { api, can, useApi, useCurrentOutlet, useSession } from '../api';
import { CrudPage, ErrorNote, Page, yesNo } from '../ui';

export function OutletsPage() {
  const s = useSession();
  return (
    <CrudPage
      title="Outlets"
      intro="Each outlet gets a main store, a kitchen store and a bar store. The FSSAI number prints on every bill."
      path="/outlets"
      canManage={can(s, 'outlets.manage', null)}
      columns={[
        { label: 'Name', render: (r: any) => r.name },
        { label: 'Code', render: (r: any) => <code>{r.code}</code> },
        { label: 'State', render: (r: any) => r.state },
        { label: 'FSSAI', render: (r: any) => r.fssaiNumber ?? '—' },
        { label: 'Excise licence', render: (r: any) => r.exciseLicence ?? '—' },
        { label: 'Status', render: (r: any) => yesNo(r.active) },
      ]}
      defaults={{ state: 'Karnataka', active: true }}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'code', label: 'Short code', required: true, help: 'Used in bill numbers, e.g. BLR1' },
        { name: 'state', label: 'State', required: true },
        { name: 'address', label: 'Address', type: 'textarea' },
        { name: 'gstin', label: 'GSTIN' },
        { name: 'fssaiNumber', label: 'FSSAI licence number', help: '14 digits' },
        { name: 'exciseLicence', label: 'Excise licence number' },
        { name: 'active', label: 'Active', type: 'checkbox' },
      ]}
    />
  );
}

// Business-wide values, with per-outlet overrides where they make sense.
export function SettingsPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const outletName = s?.outlets.find((o) => o.id === outletId)?.name;
  const biz = useApi<any>('/settings');
  const outlet = useApi<any>(outletId ? `/settings?outletId=${outletId}` : null);
  const [error, setError] = useState<string | null>(null);

  async function put(key: string, value: unknown, forOutlet: boolean) {
    try {
      setError(null);
      await api('/settings', { method: 'PUT', body: { outletId: forOutlet ? outletId : null, key, value } });
      await Promise.all([biz.reload(), outlet.reload()]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const b = biz.data?.effective ?? {};
  const o = outlet.data;

  return (
    <Page title="Settings" intro="Values for the whole business. Where an outlet can differ, its own value overrides the business value.">
      <ErrorNote error={error ?? biz.error} />
      <section className="card">
        <h2>Nightly indent</h2>
        <div className="grid">
          <div className="field">
            <label htmlFor="cutoff">Cut-off time (business)</label>
            <input id="cutoff" type="time" defaultValue={b['indent.cutoff']} key={b['indent.cutoff']} onBlur={(e) => put('indent.cutoff', e.target.value, false)} />
            <small className="muted">India time. Default 23:00.</small>
          </div>
          <div className="field">
            <label htmlFor="cutoff-o">Cut-off time at {outletName}</label>
            <input id="cutoff-o" type="time" defaultValue={o?.outlet['indent.cutoff'] ?? ''} key={o?.outlet['indent.cutoff'] ?? 'none'} onBlur={(e) => put('indent.cutoff', e.target.value || null, true)} />
            <small className="muted">Blank uses the business time ({o?.effective['indent.cutoff']} now applies).</small>
          </div>
          <div className="field">
            <label htmlFor="mode">After the indent is built</label>
            <select id="mode" value={b['indent.mode'] ?? 'approval'} onChange={(e) => put('indent.mode', e.target.value, false)}>
              <option value="approval">Wait for a manager to approve</option>
              <option value="auto">Send automatically</option>
            </select>
          </div>
        </div>
      </section>
      <section className="card">
        <h2>Receiving and pricing</h2>
        <div className="grid">
          <NumberSetting label="Hold a goods received note when the billed rate is above the last rate by more than (%)" k="receiving.rateTolerancePct" value={b['receiving.rateTolerancePct']} onSave={(v) => put('receiving.rateTolerancePct', v, false)} />
          <NumberSetting label="Price changes above this % need approval" k="approvals.priceChangeLimitPct" value={b['approvals.priceChangeLimitPct']} onSave={(v) => put('approvals.priceChangeLimitPct', v, false)} />
          <NumberSetting label='"Few left" when portions are at or below' k="menu.lowThresholdServes" value={b['menu.lowThresholdServes']} onSave={(v) => put('menu.lowThresholdServes', v, false)} />
        </div>
      </section>
      <section className="card">
        <h2>Beverage offers at {outletName}</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={!!o?.effective['offers.liquorEnabled']}
            disabled={!can(s, 'offers.liquorSwitch', outletId)}
            onChange={(e) => put('offers.liquorEnabled', e.target.checked, true)}
          />
          Automatic offers on beverages are on at this outlet
        </label>
        <p className="muted">
          Owner-level switch. Rules on alcohol promotions differ by state and licence; check with an excise consultant before switching this on.
        </p>
      </section>
    </Page>
  );
}

function NumberSetting({ label, k, value, onSave }: { label: string; k: string; value: number; onSave: (v: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={k}>{label}</label>
      <input id={k} inputMode="decimal" defaultValue={value} key={value} onBlur={(e) => e.target.value !== String(value) && onSave(Number(e.target.value))} />
    </div>
  );
}
