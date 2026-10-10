# F&B Management System

Multi-customer food and beverage management for restaurants and bars in India, built for White Tusker Private Limited.
The agreed design is in [docs/FNB-Management-System-Handoff.md](docs/FNB-Management-System-Handoff.md); choices made while building are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Run it

Requires Docker Desktop.

```sh
docker compose up --build
```

- Admin web app: http://localhost:5173
- API: http://localhost:3000/api (also proxied at http://localhost:5173/api)

On first start the API migrates the control database and every customer database, then creates a **sample** demo customer if there are no customers yet. Sign in as `owner@demo.test` / `Demo@1234` (more sample sign-ins in [docs/phase-1-summary.md](docs/phase-1-summary.md)).

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
```

| Command | What it does |
| --- | --- |
| `pnpm test` | All tests. API tests need Postgres running (`docker compose up -d postgres`); they create and drop their own customer databases |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm db:migrate` | Migrate the control database, then every customer database |
| `pnpm customer:create <code> "<name>" --owner-login <login> --owner-password <pw> [--owner-name <name>]` | Add a customer: creates its database, migrates it, loads the starting catalog and its owner sign-in |
| `pnpm seed [--reset]` | Create (or rebuild) the sample demo customer |
| `pnpm --filter @fnb/api db:generate` | After changing `apps/api/src/db/*-schema.ts`, generate the next SQL migration |

## Layout

```
apps/api        NestJS API (ES modules). src/db: schemas, per-customer connections, migrations runner
                migrations/control, migrations/tenant: SQL migrations (generated + hand-written triggers)
apps/admin      React admin web app (Vite)
packages/shared Types, permissions, input validation and money maths shared by API and apps
packages/theme  theme.css + logo files: the only place brand colours, fonts, radii and logo live
docs            Handoff, decisions, phase summaries
```

## How customers are kept apart

- One application; **one PostgreSQL database per customer**. A small control database (`fnb_control`) holds only the customer list, each customer's database name, and the sign-in routing (which customer a login belongs to).
- Sign-in finds the customer first. The token carries the customer id; every request resolves it to that customer's own connection pool. There is no customer column in business tables, so no query can reach another customer's data.
- Every change runs in a transaction that tags the user and device; a database trigger writes the audit log. The stock ledger, audit log and vendor rate history are append-only (enforced by triggers); bills, orders and payments cannot be deleted.
