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
            <Link to={`/outlets/${slug(r)}`} className="link" onClick={(e) => e.stopPropagation()}>
              QR code
            </Link>
          ),
        },
        { label: 'Status', render: (r: any) => yesNo(r.active) },
      ]}
      defaults={{ state: 'Karnataka', active: true }}
      fields={[
        { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Indiranagar Flagship, Koramangala Lounge' },
        { name: 'code', label: 'Short code', required: true, placeholder: 'e.g. BLR1', help: 'Used in bill numbers, e.g. BLR1' },
        { name: 'state', label: 'State', required: true, placeholder: 'e.g. Karnataka' },
        { name: 'address', label: 'Address', type: 'textarea', span: 'full', placeholder: 'e.g. 12th Main Road, HAL 2nd Stage, Indiranagar, Bengaluru - 560038' },
        { name: 'gstin', label: 'GSTIN', placeholder: 'e.g. 29AAAAA0000A1Z5' },
        { name: 'fssaiNumber', label: 'FSSAI licence number', placeholder: 'e.g. 11223344556677', help: '14 digits' },
        { name: 'exciseLicence', label: 'Excise licence number', placeholder: 'e.g. CL-9/EXC/2026/049' },
        { name: 'active', label: 'Active', type: 'checkbox', span: 'full' },
      ]}
      aside={(r: any) => <MenuQr title="Guest menu QR code" label={r.name} url={`${location.origin}${guestMenuPath(s!.customer.code, r.code)}`} />}
    />
  );
}
