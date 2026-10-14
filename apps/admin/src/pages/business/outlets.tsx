import { Link } from 'react-router-dom';
import { guestMenuPath } from '@fnb/shared';
import { can, useSession } from '../../api';
import { CrudPage, yesNo } from '../../ui';
import { MenuQr } from './qr';

// /outlets/blr1: an outlet's details, with the QR code for its guest menu.
export function OutletsPage() {
  const s = useSession();
  const slug = (r: any) => String(r.code).toLowerCase();
  return (
    <CrudPage
      singular="outlet"
      title="Outlets"
      intro="Each outlet gets a main store, a kitchen store and a bar store. The FSSAI number prints on every bill."
      path="/outlets"
      canManage={can(s, 'outlets.manage', null)}
      slugOf={slug}
      columns={[
        { label: 'Name', render: (r: any) => r.name },
        { label: 'Code', render: (r: any) => <code>{r.code}</code> },
        { label: 'State', render: (r: any) => r.state },
        { label: 'FSSAI', render: (r: any) => r.fssaiNumber ?? '—' },
        { label: 'Excise licence', render: (r: any) => r.exciseLicence ?? '—' },
        {
          label: 'Guest menu',
          render: (r: any) => (
            <Link to={`/outlets/${slug(r)}`} onClick={(e) => e.stopPropagation()}>
              QR code
            </Link>
          ),
        },
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
      aside={(r: any) => <MenuQr title="Guest menu QR code" label={r.name} url={`${location.origin}${guestMenuPath(s!.customer.code, r.code)}`} />}
    />
  );
}
