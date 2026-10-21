import { slugify } from '@fnb/shared';
import { can, useApi, useSession } from '../../api';
import { Badge, CrudPage, yesNo } from '../../ui';

// /users/<sign-in>: one person, their PIN and their roles at each outlet.
export function UsersPage() {
  const s = useSession();
  const roles = useApi<any[]>('/roles');
  const outlets = useApi<any[]>('/outlets');
  const roleName = (id: string) => roles.data?.find((r) => r.id === id)?.name ?? '?';
  const outletName = (id: string | null) => (id ? (outlets.data?.find((o) => o.id === id)?.name ?? '?') : 'All outlets');
  return (
    <CrudPage
      singular="user"
      title="Users"
      intro="Each person signs in with their email or phone. A PIN (4 to 6 digits) lets staff switch user quickly on a shared tablet."
      path="/users"
      canManage={can(s, 'users.manage', null)}
      slugOf={(r: any) => slugify(r.login)}
      columns={[
        { label: 'Name', render: (r: any) => r.name },
        { label: 'Sign-in', render: (r: any) => r.login },
        {
          label: 'Roles',
          render: (r: any) =>
            r.roles.map((x: any) => (
              <div key={x.roleId + x.outletId}>
                {roleName(x.roleId)} <span className="muted">· {outletName(x.outletId)}</span>
              </div>
            )),
        },
        { label: 'PIN', render: (r: any) => (r.hasPin ? 'Set' : <Badge tone="warning">Not set</Badge>) },
        { label: 'Status', render: (r: any) => yesNo(r.active) },
      ]}
      defaults={{ active: true, roles: [] }}
      fields={[
        { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Rahul Sharma' },
        { name: 'login', label: 'Sign-in (email or phone)', required: true, placeholder: 'rahul@restaurant.com or 9876543210' },
        { name: 'phone', label: 'Phone', placeholder: '+91 98765 43210' },
        { name: 'password', label: 'Password', type: 'password', placeholder: '••••••••', help: 'At least 8 characters. Leave blank to keep current password.' },
        { name: 'pin', label: 'PIN', type: 'password', placeholder: '4-6 digit PIN', help: '4 to 6 digits. Leave blank to keep current PIN.' },
        { name: 'active', label: 'Active user', type: 'checkbox', span: 'full' as const },
      ]}
      extra={(v, set) => (
        <fieldset className="field">
          <legend>Roles and outlets</legend>
          {v.roles.map((r: any, i: number) => (
            <div key={i} className="row">
              <select aria-label="Role" value={r.roleId} onChange={(e) => set('roles', v.roles.map((x: any, j: number) => (j === i ? { ...x, roleId: e.target.value } : x)))}>
                {(roles.data ?? []).map((ro) => (
                  <option key={ro.id} value={ro.id}>
                    {ro.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Outlet"
                value={r.outletId ?? ''}
                onChange={(e) => set('roles', v.roles.map((x: any, j: number) => (j === i ? { ...x, outletId: e.target.value || null } : x)))}
              >
                <option value="">All outlets</option>
                {(outlets.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button type="button" className="ghost" onClick={() => set('roles', v.roles.filter((_: any, j: number) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => set('roles', [...v.roles, { roleId: roles.data?.[0]?.id, outletId: null }])}>
            Add role
          </button>
        </fieldset>
      )}
    />
  );
}
