# F&B Management System

Multi-customer food and beverage management for restaurants and bars in India, built for White Tusker Private Limited.
The agreed design is in [docs/FNB-Management-System-Handoff.md](docs/FNB-Management-System-Handoff.md); choices made while building are in [docs/DECISIONS.md](docs/DECISIONS.md); the developer handover is [docs/HANDOVER.md](docs/HANDOVER.md).

## Run it

Requires Docker Desktop. On Windows, one command does everything: starts Docker if needed, builds and starts the system, waits until it is ready, opens the apps and prints the sign-ins.

```powershell
.
un.ps1            # or double-click run.cmd
.
un.ps1 stop       # stop (data is kept)
.
un.ps1 reset      # wipe all data and start fresh with the sample data
.
un.ps1 logs       # follow the server's messages
```

On any system the plain equivalent is `docker compose up --build`.

| App | Address | For |
| --- | --- | --- |
| Admin and dashboard | http://localhost:5173 | Owner, managers, chef, storekeeper, accounts |
| Billing POS | http://localhost:5173/pos/ | Cashier (tablet or desktop; installable; works offline) |
| Receiving | http://localhost:5173/receiving/ | Watchman and storekeeper (phone; installable; works offline) |
| Guest QR menu | http://localhost:5173/m/demo/BLR1 (menu only); each table's own QR code (admin › Tables) also takes orders | Guests (no sign-in) |
| API | http://localhost:3000/api | |

On first start the API migrates the control database and every customer database, then creates a **sample** demo customer if there are no customers yet. Sign in as `owner@demo.test` / `Demo@1234`; the other sample sign-ins are in [docs/phase-1-summary.md](docs/phase-1-summary.md).

To wipe everything and start again: `docker compose down -v`.

## Develop

Requires Node 24+ and pnpm 11 (`corepack enable`).

```sh
pnpm install
cp .env.example .env
docker compose up -d postgres redis objects   # services only
pnpm --filter @fnb/shared build
pnpm seed                                      # migrate + sample data (pnpm seed --reset to rebuild)
pnpm dev:api                                   # http://localhost:3000/api
pnpm dev:admin                                 # http://localhost:5173 (proxies /api)
pnpm --filter @fnb/field dev                   # http://localhost:5174/pos/, /receiving/, /menu/?c=demo&o=BLR1
```

| Command | What it does |
| --- | --- |
| `pnpm test` | All tests. API tests need Postgres, Redis and the object store running (`docker compose up -d postgres redis objects`); they create and drop their own customer databases |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm db:migrate` | Migrate the control database, then every customer database |
| `pnpm customer:create <code> "<name>" --owner-login <login> --owner-password <pw> [--owner-name <name>]` | Add a customer: creates its database, migrates it, loads the starting catalog and its owner sign-in |
| `pnpm seed [--reset]` | Create (or rebuild) the sample demo customer |
| `pnpm --filter @fnb/api cli backup [code]` / `backups <code>` / `restore <code> [date]` | Back up now, list backups, restore (needs `pg_dump` / `pg_restore`; inside Docker use `docker compose exec api node dist/cli.js …`) |
| `pnpm --filter @fnb/api cli customer:export <code> <file.zip>` | Every table of one customer as CSV |
| `pnpm --filter @fnb/api cli customer:delete <code> --confirm` | Final backup, then remove the customer's database, files and sign-ins |
| `pnpm --filter @fnb/api cli rollups:rebuild [code]` | Rebuild the dashboard summary tables from bills |
| `pnpm --filter @fnb/api db:generate` | After changing `apps/api/src/db/*-schema.ts`, generate the next SQL migration |

## Layout

```
apps/api        NestJS API (ES modules). src/db: schemas, per-customer connections, migration runner
                migrations/control, migrations/tenant: SQL migrations (generated + hand-written triggers)
apps/admin      React admin and dashboard (Vite). Its Docker image serves every browser app via nginx
apps/field      POS, receiving app (installable, offline queue) and the guest QR menu (Vite multi-page)
packages/shared Types, permissions, validation, money maths and every numbered rule (with tests)
packages/theme  theme.css + logo files: the only place brand colours, fonts, radii, chart colours and logo live
docs            Handoff, decisions, phase summaries, handover
```

## How customers are kept apart

- One application; **one PostgreSQL database per customer**. A small control database (`fnb_control`) holds only the customer list, each customer's database name, and the sign-in routing (which customer a login belongs to).
- Sign-in finds the customer first. The token carries the customer id; every request resolves it to that customer's own connection pool. There is no customer column in business tables, so no query can reach another customer's data. Files live in one private bucket per customer.
- Every change runs in a transaction that tags the user and device; a database trigger writes the audit log. The stock ledger, audit log and vendor rate history are append-only (enforced by triggers); bills, orders and payments cannot be deleted.
