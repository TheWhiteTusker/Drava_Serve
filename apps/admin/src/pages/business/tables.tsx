import { Link } from 'react-router-dom';
import { guestMenuPath, tableSlug } from '@fnb/shared';
import { can, useApi, useCurrentOutlet, useSession } from '../../api';
import { useRecordPath } from '../../routing';
import { BackButton, CrudPage, Page, yesNo } from '../../ui';
import { MenuQr, QrImage } from './qr';

// Tables at the current outlet: /tables/t4-k7q2 is one table with its QR code, /tables/qr-codes
// all of them on one printable sheet. Guests who scan a table's code can send an order; staff
// accept or turn it down on the POS.
export function TablesPage() {
  const s = useSession();
  const outletId = useCurrentOutlet();
  const rec = useRecordPath();
  const outlet = s?.outlets.find((o) => o.id === outletId);
  const tables = useApi<any[]>(outletId ? `/tables?outletId=${outletId}` : null);
  if (!outletId || !outlet) return <p className="muted">You are not assigned to an outlet yet.</p>;
  const url = (tb: any) => `${location.origin}${guestMenuPath(s!.customer.code, outlet.code, tb)}`;

  if (rec.slug === 'qr-codes') {
    return (
      <Page title={`QR codes for ${outlet.name}`} actions={<BackButton onClick={rec.close} label="All tables" />}>
        <div className="qr-sheet">
          {(tables.data ?? [])
            .filter((tb) => tb.active)
            .map((tb) => (
              <QrImage key={tb.id} url={url(tb)} label={`Table ${tb.name}`} size={180} />
            ))}
        </div>
        <button onClick={() => window.print()}>Print</button>
      </Page>
    );
  }
  return (
    <CrudPage
      key={outletId}
      singular="table"
      title={`Tables at ${outlet.name}`}
      intro="Print each table's QR code and place it on that table. Guests who scan it can send an order; it waits on the POS until staff accept it. Ordering can be switched off in Settings."
      path="/tables"
      query={`?outletId=${outletId}`}
      canManage={can(s, 'outlets.manage', outletId)}
      slugOf={(r: any) => tableSlug(r)}
      before={
        <button className="ghost" onClick={() => rec.open('qr-codes')}>
          Print all QR codes
        </button>
      }
      columns={[
        { label: 'Table', render: (r: any) => r.name },
        { label: 'Order on POS', render: (r: any) => r.sortOrder },
        {
          label: 'QR code',
          render: (r: any) => (
            <Link to={`/tables/${tableSlug(r)}`} onClick={(e) => e.stopPropagation()}>
              QR code
            </Link>
          ),
        },
        { label: 'In use', render: (r: any) => yesNo(r.active) },
      ]}
      defaults={{ outletId, sortOrder: (tables.data?.length ?? 0) + 1, active: true }}
      fields={[
        { name: 'name', label: 'Name', required: true, help: 'As staff call it, e.g. T4 or Patio 2' },
        { name: 'sortOrder', label: 'Position on the POS table picker', type: 'number' },
        { name: 'active', label: 'In use', type: 'checkbox', help: 'A table not in use takes no orders from its QR code' },
      ]}
      aside={(r: any) => <MenuQr title="This table's QR code" label={`Table ${r.name}`} url={url(r)} />}
    />
  );
}
