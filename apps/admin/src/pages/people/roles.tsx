import { useState } from 'react';
import { PERMISSIONS, slugify, type Permission } from '@fnb/shared';
import { api, can, useApi, useSession } from '../../api';
import { useRecordPath } from '../../routing';
import { BackButton, Empty, ErrorNote, Page, toast } from '../../ui';

// Group permission codes by their prefix for a readable grid.
const GROUPS: [string, string[]][] = [
  ['Access and audit', ['users', 'outlets', 'settings', 'audit', 'approvals', 'data']],
  ['Catalog and pricing', ['catalog', 'recipes', 'prices', 'pricing', 'menu', 'offers', 'tax']],
  ['Inventory', ['inventory']],
  ['Purchasing and receiving', ['vendors', 'rates', 'indent', 'receiving', 'grn', 'accounts']],
  ['Billing', ['pos']],
  ['Reports', ['reports']],
];

// /roles lists the roles; /roles/new and /roles/<name> edit one.
export function RolesPage() {
  const s = useSession();
  const roles = useApi<any[]>('/roles');
  const rec = useRecordPath();
  const manage = can(s, 'users.manage', null);

  if (rec.slug) {
    const role = rec.slug === 'new' ? { name: '', description: '', permissions: [] } : roles.data?.find((r) => slugify(r.name) === rec.slug);
    if (!role) {
      return (
        <Page title="Roles" actions={<BackButton onClick={rec.close} label="All roles" />}>
          {roles.data ? <Empty title="No role at this address">It may have been renamed. Pick it from the list.</Empty> : <p className="muted">Loading…</p>}
        </Page>
      );
    }
    const done = async () => {
      await roles.reload();
      rec.close();
    };
    return <RoleForm key={rec.slug} role={role} manage={manage} onClose={rec.close} onSaved={done} />;
  }

  return (
    <Page
      title="Roles"
      intro="A role is a set of permissions. Change them here without any code change; the API checks them on every request."
      actions={manage && <button onClick={() => rec.open('new')}>Add role</button>}
    >
      <ErrorNote error={roles.error} />
      <div className="cards">
        {(roles.data ?? []).map((r) => (
          <article key={r.id} className="card">
            <header className="row between">
              <h3>{r.name}</h3>
              <button className="ghost" onClick={() => rec.open(slugify(r.name))}>
                {manage ? 'Edit' : 'View'}
              </button>
            </header>
            <p className="muted">{r.description}</p>
            <p>
              {r.permissions.length} of {Object.keys(PERMISSIONS).length} permissions
            </p>
          </article>
        ))}
      </div>
    </Page>
  );
}

function RoleForm({ role, manage, onClose, onSaved }: { role: any; manage: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState<any>(() => ({ ...role }));
  const [error, setError] = useState<string | null>(null);
  const toggle = (p: string) =>
    setEditing((e: any) => ({ ...e, permissions: e.permissions.includes(p) ? e.permissions.filter((x: string) => x !== p) : [...e.permissions, p] }));

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    try {
      const { id, name, description, permissions, version } = editing;
      await api(id ? `/roles/${id}` : '/roles', { method: id ? 'PUT' : 'POST', body: { name, description, permissions, version } });
      toast('Role saved');
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Page eyebrow="Roles" title={role.id ? role.name : 'Add role'} actions={<BackButton onClick={onClose} label="All roles" />}>
      <form className="card" onSubmit={save}>
        <fieldset disabled={!manage} className="bare">
          <div className="grid">
            <div className="field">
              <label htmlFor="role-name">Name</label>
              <input id="role-name" placeholder="e.g. Head Bartender, Sous Chef, Floor Manager" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="role-desc">Description</label>
              <input id="role-desc" placeholder="e.g. Full inventory and recipe management for bar operations" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
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
        </fieldset>
        <ErrorNote error={error} />
        <footer className="row end">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          {manage && <button className="gold">Save role</button>}
        </footer>
      </form>
    </Page>
  );
}
