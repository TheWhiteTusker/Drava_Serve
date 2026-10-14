import { useState } from 'react';
import { Link } from 'react-router-dom';
import { slugify } from '@fnb/shared';
import { can, useSession } from '../../api';
import { useRecordPath } from '../../routing';
import { BackButton, CrudPage, Page, yesNo } from '../../ui';
import { VendorItems } from './vendor-items';
import { RateHistory } from './rate-history';

// ---------- Vendors and rate history ----------

// /vendors/<name> edits a vendor; /vendors/<name>/items is what they supply.
export function VendorsPage() {
  const s = useSession();
  const rec = useRecordPath();
  const [tab, setTab] = useState<'vendors' | 'rates'>('vendors');
  return (
    <>
      {!rec.slug && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'vendors'} className={tab === 'vendors' ? '' : 'ghost'} onClick={() => setTab('vendors')}>
            Vendors
          </button>
          {can(s, 'rates.view') && (
            <button role="tab" aria-selected={tab === 'rates'} className={tab === 'rates' ? '' : 'ghost'} onClick={() => setTab('rates')}>
              Rate history
            </button>
          )}
        </div>
      )}
      {tab === 'vendors' || rec.slug ? (
        <CrudPage
          singular="vendor"
          title="Vendors"
          intro="Who supplies what. Each vendor's items set the purchase unit and pack size the nightly indent rounds up to."
          path="/vendors"
          canManage={can(s, 'vendors.manage')}
          columns={[
            { label: 'Name', render: (r: any) => r.name },
            { label: 'Part', render: (r: any) => ({ food: 'Food', beverage: 'Beverage', both: 'Both' })[r.department as string] },
            { label: 'Contact', render: (r: any) => [r.contactName, r.phone].filter(Boolean).join(' · ') || '—' },
            {
              label: 'Supplies',
              render: (r: any) => (
                <Link to={`/vendors/${slugify(r.name)}/items`} onClick={(e) => e.stopPropagation()}>
                  Items
                </Link>
              ),
            },
            { label: 'Status', render: (r: any) => yesNo(r.active) },
          ]}
          defaults={{ department: 'food', active: true }}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'department', label: 'Part', type: 'select', required: true, options: [{ value: 'food', label: 'Food' }, { value: 'beverage', label: 'Beverage' }, { value: 'both', label: 'Both' }] },
            { name: 'contactName', label: 'Contact person' },
            { name: 'phone', label: 'Phone (for WhatsApp)' },
            { name: 'email', label: 'Email' },
            { name: 'gstin', label: 'GSTIN' },
            { name: 'address', label: 'Address', type: 'textarea' },
            { name: 'active', label: 'Active', type: 'checkbox' },
          ]}
          subPages={{
            items: (r: any) => (
              <Page eyebrow="Vendors" title={`What ${r.name} supplies`} actions={<BackButton onClick={rec.close} label="All vendors" />}>
                <VendorItems vendor={r} onDone={rec.close} />
              </Page>
            ),
          }}
        />
      ) : (
        <RateHistory />
      )}
    </>
  );
}
