import { useState } from 'react';
import { slugify } from '@fnb/shared';
import { can, useApi, useCurrentOutlet, useSession } from '../../api';
import { useLiveReload } from '../../live';
import { useRecordPath } from '../../routing';
import { BackButton, Badge, DietMark, Empty, ErrorNote, Page, rupee } from '../../ui';
import { RecipeEditor } from './recipe-editor';
import { Placement } from './placement';

// ---------- Menu costs, margins and order ----------

// /costing lists dishes by margin; /costing/<dish> is its recipe, /costing/<dish>/placement its pin.
export function CostingPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const [dept, setDept] = useState<'food' | 'beverage'>('food');
  const [alcoholic, setAlcoholic] = useState(true);
  const rows = useApi<any[]>(outletId ? `/costing?outletId=${outletId}` : null);
  const rec = useRecordPath();
  useLiveReload(['menu', 'availability'], rows.reload);
  if (!outletId) return null;
  if (rec.slug) {
    const item = rows.data?.find((r) => slugify(r.name) === rec.slug);
    const done = () => (rec.close(), rows.reload());
    return (
      <Page eyebrow="Menu costs" title={item ? `${rec.sub === 'placement' ? 'Placement' : 'Recipe'}: ${item.name}` : 'Menu item'} actions={<BackButton onClick={done} label="All dishes" />}>
        {!item ? (
          rows.data ? <Empty title="No menu item at this address" /> : <p className="muted">Loading…</p>
        ) : rec.sub === 'placement' ? (
          <Placement item={item} onDone={done} />
        ) : (
          <RecipeEditor item={item} onDone={done} />
        )}
      </Page>
    );
  }
  const list = (rows.data ?? []).filter((r) => r.department === dept && (dept === 'food' || r.alcoholic === alcoholic));
  const groups = [...new Set(list.map((r) => r.category))];
  return (
    <Page
      title="Menu costs and order"
      intro={
        <>
          Portion cost comes from each recipe and the latest billed rates. Inside each course, dishes are listed by margin %, highest first (sold-out dishes drop to the end; pinned
          dishes stay on top). Note: a cheap dish with a high margin % can rank above one that earns more rupees per plate, so both figures are shown. Margins never appear on the
          POS or the guest menu.
        </>
      }
    >
      <div className="tabs" role="tablist">
        {(['food', 'beverage'] as const).map((d) => (
          <button key={d} role="tab" aria-selected={dept === d} className={dept === d ? '' : 'ghost'} onClick={() => setDept(d)}>
            {d === 'food' ? 'Food' : 'Beverage'}
          </button>
        ))}
        {dept === 'beverage' &&
          ([true, false] as const).map((a) => (
            <button key={String(a)} role="tab" aria-selected={alcoholic === a} className={alcoholic === a ? 'secondary' : 'ghost'} onClick={() => setAlcoholic(a)}>
              {a ? 'Alcoholic' : 'Non-alcoholic'}
            </button>
          ))}
      </div>
      {rows.data && !list.length && <Empty title="No dishes here yet">Add them under the menu, then give each a recipe.</Empty>}
      <ErrorNote error={rows.error} />
      {groups.map((g) => (
        <section key={g} style={{ marginBottom: '1.25rem' }}>
          <h2>{g}</h2>
          <div className="table-wrap">
            <table className="aligned">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th className="num">Price</th>
                  <th className="num">Portion cost</th>
                  <th className="num">Margin</th>
                  <th className="num">Target</th>
                  <th className="num">Left</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {list
                  .filter((r) => r.category === g)
                  .map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>
                        <span className="row tight">
                          <DietMark diet={r.dietType} /> {r.name}
                          {r.pinPosition && <Badge>pinned #{r.pinPosition}</Badge>}
                          {r.offerExcluded && <Badge>no offers</Badge>}
                        </span>
                      </td>
                      <td className="num">
                        {rupee(r.sellingPrice)}
                        {r.offerPrice && <div className="muted">charging {rupee(r.offerPrice)} (offer)</div>}
                      </td>
                      <td className="num">{rupee(r.portionCost)}</td>
                      <td className="num">
                        <strong>{r.marginPct}%</strong> <span className="muted">· {rupee(r.marginAmount)}</span>
                      </td>
                      <td className="num">
                        {r.targetPct ? `${Number(r.targetPct)}%` : '—'}
                        {r.underTarget && (
                          <div>
                            <Badge tone="danger">under target</Badge> <span className="muted">suggest {rupee(r.suggestedPrice)}</span>
                          </div>
                        )}
                      </td>
                      <td className="num">{r.portions == null ? '—' : Number(r.portions) <= 0 ? <Badge tone="danger">Out</Badge> : Number(r.portions)}</td>
                      <td className="actions">
                        {can(s, 'recipes.manage', outletId) && (
                          <button className="link" onClick={() => rec.open(slugify(r.name))}>
                            Recipe
                          </button>
                        )}
                        {can(s, 'menu.pins', outletId) && (
                          <button className="link" onClick={() => rec.open(`${slugify(r.name)}/placement`)}>
                            Pin / offers
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </Page>
  );
}
