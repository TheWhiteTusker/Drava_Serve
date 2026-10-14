import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, stamps, ts } from './columns.js';

// ---------- Access and audit ----------

export const outlet = pgTable('outlet', {
  id: id(),
  name: text().notNull(),
  code: text().notNull().unique(),
  state: text().notNull(),
  address: text(),
  gstin: text(),
  fssaiNumber: text(),
  exciseLicence: text(),
  active: boolean().notNull().default(true),
  ...stamps,
});

export const appUser = pgTable('app_user', {
  id: id(),
  name: text().notNull(),
  login: text().notNull().unique(),
  phone: text(),
  passwordHash: text(),
  pinHash: text(),
  failedAttempts: integer().notNull().default(0),
  lockedUntil: ts(),
  active: boolean().notNull().default(true),
  ...stamps,
});

export const role = pgTable('role', {
  id: id(),
  name: text().notNull().unique(),
  description: text(),
  ...stamps,
});

export const rolePermission = pgTable(
  'role_permission',
  {
    roleId: uuid().notNull().references(() => role.id, { onDelete: 'cascade' }),
    permission: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

// outletId null = the role applies at every outlet.
export const userRole = pgTable(
  'user_role',
  {
    id: id(),
    userId: uuid().notNull().references(() => appUser.id, { onDelete: 'cascade' }),
    roleId: uuid().notNull().references(() => role.id, { onDelete: 'cascade' }),
    outletId: uuid().references(() => outlet.id),
  },
  (t) => [unique().on(t.userId, t.roleId, t.outletId).nullsNotDistinct()],
);

// Customer-wide setting when outletId is null; an outlet row overrides it.
export const setting = pgTable(
  'setting',
  {
    id: id(),
    outletId: uuid().references(() => outlet.id),
    key: text().notNull(),
    value: jsonb().notNull(),
    ...stamps,
  },
  (t) => [unique().on(t.outletId, t.key).nullsNotDistinct()],
);

export const approvalRequest = pgTable(
  'approval_request',
  {
    id: id(),
    outletId: uuid().references(() => outlet.id),
    type: text().notNull(), // e.g. price_change, wastage, count_correction, bill_cancel
    entity: text().notNull(),
    entityId: text(),
    current: jsonb(),
    proposed: jsonb().notNull(),
    reason: text(),
    status: text().$type<'pending' | 'approved' | 'rejected' | 'cancelled'>().notNull().default('pending'),
    proposedBy: uuid().references(() => appUser.id), // null when raised by the system (e.g. a margin flag)
    proposedAt: ts().notNull().defaultNow(),
    decidedBy: uuid().references(() => appUser.id),
    decidedAt: ts(),
    decisionNote: text(),
    ...stamps,
  },
  (t) => [index().on(t.status, t.outletId)],
);

// Written by a database trigger on every audited table (see migrations), so no code path can skip it.
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: ts().notNull().defaultNow(),
    userId: uuid(),
    deviceId: text(),
    outletId: uuid(),
    entity: text().notNull(),
    entityId: text(),
    action: text().notNull(),
    before: jsonb(),
    after: jsonb(),
  },
  (t) => [index().on(t.entity, t.entityId), index().on(t.at)],
);
