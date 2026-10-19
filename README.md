# F&B Management System

Multi-customer food and beverage management for restaurants and bars in India, built for White Tusker Private Limited.
The agreed design is in [docs/FNB-Management-System-Handoff.md](docs/FNB-Management-System-Handoff.md); choices made while building are in [docs/DECISIONS.md](docs/DECISIONS.md); the developer handover is [docs/HANDOVER.md](docs/HANDOVER.md).

## Set up

Needs **Node 24+**, **pnpm 11** (`corepack enable`) and **two Supabase projects** in Mumbai (`ap-south-1`): one for development, one for production. Nothing else runs on your machine.

1. `pnpm install`
2. `cp .env.example .env`, then set `POSTGRES_URL` to the **development** project's connection string (Supabase › Connect › Session pooler). Never the production one: the tests create and drop databases.
3. `pnpm --filter @fnb/shared build`
4. `pnpm seed`: creates the control database and a **sample** demo customer (`pnpm seed --reset` rebuilds it).

## Run

Each in its own terminal:

```sh
pnpm dev:api                     # API on http://localhost:3000/api
pnpm dev:admin                   # admin and dashboard
pnpm --filter @fnb/field dev     # POS, receiving app, guest menu
```

| App | Address | For |
| --- | --- | --- |
| Admin and dashboard | http://localhost:5173 | Owner, managers, chef, storekeeper, accounts |
| Billing POS | http://localhost:5174/pos/ | Cashier (tablet or desktop; installable; works offline) |
| Receiving | http://localhost:5174/receiving/ | Watchman and storekeeper (phone; installable; works offline) |
| Guest QR menu | http://localhost:5174/menu/?c=demo&o=BLR1 | Guests (no sign-in) |

Sign in as `owner@demo.test` / `Demo@1234`; the other sample sign-ins are in [docs/phase-1-summary.md](docs/phase-1-summary.md).

Optional settings in `.env` (see `.env.example`):
- `S3_*` (Supabase › Storage › S3 Connection): photo, vendor-bill and order-PDF uploads. The purchasing and dashboard tests need them too.
- `REDIS_URL`: live updates across several API servers and the scheduled jobs (nightly orders, delivery list, offer release, backups). Without it the app runs, live updates reach only devices on the same server, and those jobs do not run.

## Production

Vercel (team `twt13`, project `pos`) and the production Supabase project.

- Push to `main`: Vercel builds the admin, field and API services. The API build first migrates the production database (`pnpm cli migrate`), so schema changes go live with the code.
- Vercel environment variables: `POSTGRES_URL` (production project, Session pooler). Optional: `JWT_SECRET`, `S3_*`, `CORS_ORIGIN`.
- To run a command against production, set the URL for that terminal only: `$env:POSTGRES_URL="<production URL>"; pnpm customer:create …`, then `Remove-Item Env:POSTGRES_URL`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm test` | All tests, against the database in `.env`; they create and drop their own customer databases |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm db:migrate` | Migrate the control database, then every customer database |
| `pnpm customer:create <code> "<name>" --owner-login <login> --owner-password <pw> [--owner-name <name>]` | Add a customer: creates its database, migrates it, loads the starting catalog and its owner sign-in |
| `pnpm seed [--reset]` | Create (or rebuild) the sample demo customer |
| `pnpm --filter @fnb/api cli backup [code]` / `backups <code>` / `restore <code> [date]` | Back up now, list backups, restore (needs the PostgreSQL client tools `pg_dump` / `pg_restore`) |
| `pnpm --filter @fnb/api cli customer:export <code> <file.zip>` | Every table of one customer as CSV |
| `pnpm --filter @fnb/api cli customer:delete <code> --confirm` | Final backup, then remove the customer's database, files and sign-ins |
| `pnpm --filter @fnb/api cli rollups:rebuild [code]` | Rebuild the dashboard summary tables from bills |
| `pnpm --filter @fnb/api db:generate` | After changing `apps/api/src/db/*-schema.ts`, generate the next SQL migration |

## Layout

```
apps/api        NestJS API (ES modules). src/db: schemas, per-customer connections, migration runner
                migrations/control, migrations/tenant: SQL migrations (generated + hand-written triggers)
apps/admin      React admin and dashboard (Vite)
apps/field      POS, receiving app (installable, offline queue) and the guest QR menu (Vite multi-page)
packages/shared Types, permissions, validation, money maths and every numbered rule (with tests)
packages/theme  theme.css + logo files: the only place brand colours, fonts, radii, chart colours and logo live
docs            Handoff, decisions, phase summaries, handover
```

## How customers are kept apart

- One application; **one PostgreSQL database per customer**. A small control database (`fnb_control`) holds only the customer list, each customer's database name, and the sign-in routing (which customer a login belongs to).
- Sign-in finds the customer first. The token carries the customer id; every request resolves it to that customer's own connection pool. There is no customer column in business tables, so no query can reach another customer's data. Files live in one private bucket per customer.
- Every change runs in a transaction that tags the user and device; a database trigger writes the audit log. The stock ledger, audit log and vendor rate history are append-only (enforced by triggers); bills, orders and payments cannot be deleted.
