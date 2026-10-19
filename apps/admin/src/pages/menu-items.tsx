import { useState } from 'react';
import { ALLERGENS, TAG_SUGGESTIONS } from '@fnb/shared';
import { can, useApi, useCurrentOutlet, useSession } from '../api';
import { CrudPage, DietMark, opts, rupee, yesNo } from '../ui';

const DIETS = [
  { value: 'veg', label: 'Veg' },
  { value: 'non_veg', label: 'Non-veg' },
  { value: 'egg', label: 'Egg (shown as non-veg)' },
];

export function MenuItemsPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const [dept, setDept] = useState<'food' | 'beverage'>('food');
  const [alcoholic, setAlcoholic] = useState(true); // beverages: liquor tree, or non-alcoholic drink types
  const cats = useApi<any[]>('/categories');
  const brands = useApi<any[]>('/brands');
  const taxes = useApi<any[]>('/tax-classes');
  const catName = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? '';
  const isAlcoholic = (r: any) => cats.data?.find((c) => c.id === r.categoryId)?.kind !== 'drink_type';
  const drinkOpts = (cats.data ?? []).filter((c) => c.kind === 'drink_type').map((c) => ({ value: c.id, label: c.name }));
  const courseOpts = (cats.data ?? []).filter((c) => c.kind === 'course').map((c) => ({ value: c.id, label: c.name }));
  const liquorOpts = (cats.data ?? [])
    .filter((c) => c.kind === 'liquor_type' || c.kind === 'liquor_subtype')
    .map((c) => ({ value: c.id, label: c.parentId ? `${catName(c.parentId)} › ${c.name}` : c.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (!outletId) return <p className="muted">You are not assigned to an outlet yet.</p>;

  return (
    <CrudPage
        before={
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={dept === 'food'} className={dept === 'food' ? '' : 'ghost'} onClick={() => setDept('food')}>
              Food
            </button>
            <button role="tab" aria-selected={dept === 'beverage'} className={dept === 'beverage' ? '' : 'ghost'} onClick={() => setDept('beverage')}>
              Beverage
            </button>
            {dept === 'beverage' &&
              ([true, false] as const).map((a) => (
                <button key={String(a)} role="tab" aria-selected={alcoholic === a} className={alcoholic === a ? 'secondary' : 'ghost'} onClick={() => setAlcoholic(a)}>
                  {a ? 'Alcoholic' : 'Non-alcoholic'}
                </button>
              ))}
          </div>
        }
        singular="menu item"
        key={`${outletId}-${dept}-${alcoholic}`}
        title={dept === 'food' ? 'Food menu' : alcoholic ? 'Alcoholic beverages' : 'Non-alcoholic beverages'}
        intro={
          dept === 'food'
            ? 'Prices are before tax. Diet type prints as the veg / non-veg mark on the menu and the bill.'
            : alcoholic
              ? 'One bottle can sell as several items (30 ml, 60 ml, bottle), each with its own price. Recipes link each to the bottle.'
              : 'Soft drinks, juices, mocktails, tea and coffee. Taxed like food (GST), not liquor.'
        }
        path="/menu-items"
        query={`?outletId=${outletId}`}
        filter={(r: any) => r.department === dept && (dept === 'food' || isAlcoholic(r) === alcoholic)}
        canManage={can(s, 'catalog.manage', outletId)}
        columns={[
          {
            label: 'Item',
            render: (r: any) => (
              <span className="row tight">
                <DietMark diet={r.dietType} /> {r.name}
              </span>
            ),
          },
          { label: dept === 'food' ? 'Course' : 'Type', render: (r: any) => catName(r.categoryId) },
          ...(dept === 'beverage' ? [{ label: 'Serve', render: (r: any) => (r.serveSizeMl ? `${Number(r.serveSizeMl)} ml` : '—') }] : []),
          { label: 'Price', render: (r: any) => rupee(r.sellingPrice) },
          { label: 'Tax class', render: (r: any) => taxes.data?.find((t) => t.id === r.taxClassId)?.code ?? '' },
          ...(dept === 'food' ? [{ label: 'Allergens', render: (r: any) => r.allergens.join(', ') || '—' }] : []),
          { label: 'Status', render: (r: any) => yesNo(r.active) },
        ]}
        defaults={{
          outletId,
          department: dept,
          active: true,
          tags: [],
          allergens: [],
          taxClassId: taxes.data?.find((t) => t.kind === (dept === 'beverage' && alcoholic ? 'liquor' : 'food'))?.id ?? null,
        }}
        fields={[
          { name: 'name', label: 'Name', required: true },
          {
            name: 'categoryId', label: dept === 'food' ? 'Course' : alcoholic ? 'Liquor type or sub-type' : 'Drink type', type: 'select', required: true,
            options: dept === 'food' ? courseOpts : alcoholic ? liquorOpts : drinkOpts,
          },
          ...(dept === 'food'
            ? [{ name: 'dietType', label: 'Diet type', type: 'select' as const, required: true, options: DIETS }]
            : [
                { name: 'brandId', label: 'Brand', type: 'select' as const, options: opts(brands.data) },
                { name: 'serveSizeMl', label: 'Serve size (ml)', type: 'decimal' as const, help: 'e.g. 30, 60, 750' },
              ]),
          { name: 'sellingPrice', label: 'Price before tax (₹)', type: 'decimal', required: true },
          { name: 'taxClassId', label: 'Tax class', type: 'select', required: true, options: opts(taxes.data) },
          { name: 'targetMarginPct', label: 'Target margin % (optional)', type: 'decimal', help: 'Overrides the outlet and course targets' },
          { name: 'lowThreshold', label: '"Few left" at (portions)', type: 'number', help: 'Blank uses the outlet setting' },
          { name: 'code', label: 'Short code' },
          ...(dept === 'food'
            ? [
                { name: 'calories', label: 'Calories (optional)', type: 'number' as const },
                { name: 'allergens', label: 'Allergens', type: 'checks' as const, options: ALLERGENS.map((a) => ({ value: a, label: a[0].toUpperCase() + a.slice(1) })) },
              ]
            : []),
          { name: 'tags', label: 'Tags', type: 'tags', placeholder: 'comma separated', help: `For example: ${TAG_SUGGESTIONS.slice(0, 5).join(', ')}` },
          { name: 'description', label: 'Description', type: 'textarea' },
          { name: 'active', label: 'On the menu', type: 'checkbox' },
        ]}
      />
  );
}
