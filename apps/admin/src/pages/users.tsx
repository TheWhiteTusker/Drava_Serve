import { useState } from 'react';
import { PERMISSIONS, type Permission } from '@fnb/shared';
import { api, can, useApi, useSession } from '../api';
import { Badge, CrudPage, ErrorNote, Modal, Page, toast, yesNo } from '../ui';

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
        { name: 'name', label: 'Name', required: true },
        { name: 'login', label: 'Sign-in (email or phone)', required: true },
        { name: 'phone', label: 'Phone' },
        { name: 'password', label: 'Password', type: 'password', help: 'At least 8 characters. Leave blank to keep the current one.' },
        { name: 'pin', label: 'PIN', type: 'password', help: '4 to 6 digits. Leave blank to keep the current one.' },
        { name: 'active', label: 'Active', type: 'checkbox' },
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

// Group permission codes by their prefix for a readable grid.
const GROUPS: [string, string[]][] = [
  ['Access and audit', ['users', 'outlets', 'settings', 'audit', 'approvals', 'data']],
  ['Catalog and pricing', ['catalog', 'recipes', 'prices', 'pricing', 'menu', 'offers', 'tax']],
  ['Inventory', ['inventory']],
  ['Purchasing and receiving', ['vendors', 'rates', 'indent', 'receiving', 'grn', 'accounts']],
  ['Billing', ['pos']],
  ['Reports', ['reports']],
];

export function RolesPage() {
  const s = useSession();
  const roles = useApi<any[]>('/roles');
  const [editing, setEditing] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const manage = can(s, 'users.manage', null);
  const toggle = (p: string) =>
    setEditing((e: any) => ({ ...e, permissions: e.permissions.includes(p) ? e.permissions.filter((x: string) => x !== p) : [...e.permissions, p] }));

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    try {
      const { id, name, description, permissions, version } = editing;
      await api(id ? `/roles/${id}` : '/roles', { method: id ? 'PUT' : 'POST', body: { name, description, permissions, version } });
      setEditing(null);
      toast('Role saved');
      roles.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Page
      title="Roles"
      intro="A role is a set of permissions. Change them here without any code change; the API checks them on every request."
      actions={manage && <button onClick={() => setEditing({ name: '', description: '', permissions: [] })}>Add role</button>}
    >
      <ErrorNote error={roles.error} />
      <div className="cards">
        {(roles.data ?? []).map((r) => (
          <article key={r.id} className="card">
            <header className="row between">
              <h3>{r.name}</h3>
              {manage && (
                <button className="ghost" onClick={() => (setError(null), setEditing({ ...r }))}>
                  Edit
                </button>
              )}
            </header>
            <p className="muted">{r.description}</p>
            <p>
              {r.permissions.length} of {Object.keys(PERMISSIONS).length} permissions
            </p>
          </article>
        ))}
      </div>
      <Modal open={!!editing} title={editing?.id ? `Edit role` : 'Add role'} onClose={() => setEditing(null)} wide>
        {editing && (
          <form onSubmit={save}>
            <div className="grid">
              <div className="field">
                <label htmlFor="role-name">Name</label>
                <input id="role-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
              </div>
              <div className="field">
                <label htmlFor="role-desc">Description</label>
                <input id="role-desc" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </div>
            </div>
            {GROUPS.map(([g, prefixes]) => (
              <fieldset key={g} className="field">
                <legend>{g}</legend>
                <div className="checks">
                  {(Object.keys(PERMISSIONS) as Permission[])
                    .filter((p) => prefixes.includes(p.split('.')[0]))
                    .map((p) => (
                      <label key={p} className="check">
                        <input type="checkbox" checked={editing.permissions.includes(p)} onChange={() => toggle(p)} />
                        {PERMISSIONS[p]}
                      </label>
                    ))}
                </div>
              </fieldset>
            ))}
            <ErrorNote error={error} />
            <footer className="row end">
              <button type="button" className="ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button>Save</button>
            </footer>
          </form>
        )}
      </Modal>
    </Page>
  );
}
