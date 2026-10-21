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
                <Link to={`/vendors/${slugify(r.name)}/items`} className="link" onClick={(e) => e.stopPropagation()}>
                  Items
                </Link>
              ),
            },
            { label: 'Status', render: (r: any) => yesNo(r.active) },
          ]}
          defaults={{ department: 'food', active: true }}
          fields={[
            { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Metro Cash & Carry, Fresh Valley Dairy' },
            { name: 'department', label: 'Part', type: 'select', required: true, options: [{ value: 'food', label: 'Food' }, { value: 'beverage', label: 'Beverage' }, { value: 'both', label: 'Both' }] },
            { name: 'contactName', label: 'Contact person', placeholder: 'e.g. Rajesh Sharma' },
            { name: 'phone', label: 'Phone (for WhatsApp)', placeholder: 'e.g. +91 98765 43210' },
            { name: 'email', label: 'Email', placeholder: 'e.g. orders@supplier.com' },
            { name: 'gstin', label: 'GSTIN', placeholder: 'e.g. 29ABCDE1234F1Z5' },
            { name: 'address', label: 'Address', type: 'textarea', span: 'full', placeholder: 'e.g. Plot 42, Wholesale Market Yard, APMC Complex' },
            { name: 'active', label: 'Active', type: 'checkbox', span: 'full' },
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
