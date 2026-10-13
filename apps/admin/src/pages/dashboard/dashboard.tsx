import { useState } from 'react';
import { Boxes, IndianRupee, Receipt, ReceiptText, Trash2, Utensils, Wine } from 'lucide-react';
import { ActivityCard } from '../activity';
import { useApi, useCurrentOutlet, useSession } from '../../api';
import { useLiveReload } from '../../live';
import { ErrorNote, Page, rupee } from '../../ui';
import { PRESETS, num } from './shared';
import { Block, HourColumns, Tile } from './charts';
import { Welcome, greeting } from './welcome';
import { DemandBlock, MarginBlocks, OffersBlock, StockBlocks, TopBlocks } from './blocks';

// ---------- Dashboard ----------

export function DashboardPage() {
  const s = useSession();
  const current = useCurrentOutlet();
  const [range, setRange] = useState<[string, string]>(PRESETS[1][1]());
  const [outlet, setOutlet] = useState<string>(current ?? '');
  const [dept, setDept] = useState('all');
  const [demandFor, setDemandFor] = useState('');
  const [topBy, setTopBy] = useState<'units' | 'revenue'>('units');
  const cats = useApi<any[]>('/categories');
  const query = `from=${range[0]}&to=${range[1]}&department=${dept}${outlet ? `&outletId=${outlet}` : ''}`;
  const demandQ = demandFor.startsWith('i:') ? `&itemId=${demandFor.slice(2)}` : demandFor.startsWith('c:') ? `&categoryId=${demandFor.slice(2)}` : '';
  const d = useApi<any>(`/reports/dashboard?${query}${demandQ}`);
  useLiveReload(['bill', 'stock', 'menu'], d.reload);
  const x = d.data;

  return (
    <Page eyebrow={greeting()} title={s ? `Hello, ${s.user.name.replace(/\s*\(.*\)/, '')}` : 'Dashboard'} intro="Here's how the business is doing. Figures are before tax and update live as bills are paid.">
      <Welcome outletId={current} />
      <div className="filters card">
        <div className="row">
          {PRESETS.map(([label, fn]) => {
            const [a, b] = fn();
            return (
              <button key={label} className={range[0] === a && range[1] === b ? '' : 'secondary'} onClick={() => setRange([a, b])}>
                {label}
              </button>
            );
          })}
          <input type="date" aria-label="From" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} />
          <input type="date" aria-label="To" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} />
          <select aria-label="Outlet" value={outlet} onChange={(e) => setOutlet(e.target.value)}>
            <option value="">All my outlets</option>
            {(s?.outlets ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select aria-label="Food or Beverage" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="all">Food and Beverage</option>
            <option value="food">Food</option>
            <option value="beverage">Beverage</option>
          </select>
        </div>
      </div>
      <ErrorNote error={d.error} />
      {x && (
        <>
          <div className="tiles">
            <Tile icon={IndianRupee} label="Sales" value={rupee(x.sales.revenue)} note={`${range[0] === range[1] ? range[0] : `${range[0]} to ${range[1]}`}`} />
            <Tile icon={Receipt} label="Bills" value={num(x.sales.bills)} />
            <Tile icon={ReceiptText} label="Average bill" value={rupee(x.sales.averageBill)} />
            <Tile icon={Utensils} label="Food" value={rupee(x.totals.foodRevenue)} note={`${num(x.totals.plates)} plates`} />
            <Tile icon={Wine} label="Beverage" value={rupee(x.totals.beverageRevenue)} note={`${x.totals.alcoholLitres} litres of alcohol`} />
            <Tile icon={Boxes} label="Stock value now" value={rupee(Number(x.stock.value.food ?? 0) + Number(x.stock.value.beverage ?? 0))} note={`Food ${rupee(x.stock.value.food ?? 0)} · Beverage ${rupee(x.stock.value.beverage ?? 0)}`} />
            <Tile icon={Trash2} label="Wastage" value={rupee(x.stock.wastage.reduce((a: number, w: any) => a + Number(w.value), 0))} note={x.stock.wastage.map((w: any) => `${w.movement} ${rupee(w.value)}`).join(' · ') || 'none'} />
          </div>

          <div className="blocks">
            <ActivityCard outletId={outlet || null} />
            <MarginBlocks x={x} />
            <StockBlocks x={x} />
            <DemandBlock x={x} cats={cats.data} demandFor={demandFor} setDemandFor={setDemandFor} />
            <TopBlocks x={x} topBy={topBy} setTopBy={setTopBy} />
            <Block title="Average time from first order to payment">
              <HourColumns
                label="Average minutes per bill by hour opened"
                unit="average minutes per bill, by the hour the bill opened"
                rows={x.timeSpent.filter((h: any) => h.bills > 0).map((h: any) => ({ hour: h.hour, value: h.averageMinutes, detail: `${h.averageMinutes} min average over ${h.bills} bills` }))}
              />
            </Block>
            <OffersBlock x={x} />
          </div>
        </>
      )}
    </Page>
  );
}
