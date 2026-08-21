# CLAUDE.md — Yacco

## Project

Management system for a water purification plant in Peru (currency: soles, S/).
pnpm monorepo: `apps/api` (NestJS modular monolith + Prisma/PostgreSQL),
`apps/web` (React + Vite), `apps/mobile` (Expo, offline-first),
`packages/shared` (DTO contracts), `packages/sync-engine` (pure-TS offline queue).
The spec at `docs/yacco-documentacion.md` is the source of truth. If code and
spec disagree, STOP and ask before proceeding.

## Language rule (non-negotiable, retroactive)

- ALL code identifiers in English: classes `PascalCase`, variables/functions
  `camelCase`, DB tables/columns `snake_case` (plural tables), enum values
  `SCREAMING_SNAKE_CASE`, REST routes `kebab-case` plural under `/api/v1`.
- Spanish ONLY for UI strings and human docs. If you find a Spanish
  identifier anywhere, rename it.

## Commands

- `pnpm dev:api` / `pnpm dev:web` — local dev (Docker Compose must be up)
- `pnpm test` / `pnpm test:integration` — Jest/Vitest; integration uses Testcontainers
- `pnpm lint` / `pnpm typecheck` / `pnpm build`
- `pnpm prisma:validate` / `pnpm prisma:migrate` / `pnpm db:seed`
- NEVER run `prisma migrate reset` outside local Docker.

## Domain invariants (never violate)

- `container_movements` is an immutable ledger: no UPDATE/DELETE ever;
  corrections are inverse movements.
- Materialized balances (`customer_container_balances`, `customers.debt_balance`)
  update in the SAME transaction as their source movement/sale/payment and must
  always be reconstructible from the ledgers.
- Two independent debts per customer: containers (units) and money (S/).
  Never merge or convert between them.
- Route loading consumes batches strictly FIFO (oldest batch date first).
- Credit limit WARNS and records `credit_limit_exceeded`; it never blocks.
- Money is `NUMERIC(10,2)` end to end. Never floats.
- Money on the wire is a 2-decimal string (`"12.50"`), never a JSON number: a
  JSON number is an IEEE-754 double and breaks the guarantee before the value
  reaches Postgres. Parse to `Prisma.Decimal` at the edge.
- Every operational row records `created_at` and `recorded_by`/`created_by`.
- Driver field writes enter ONLY through `POST /api/v1/sync/operations`
  (idempotent by device-generated UUID; duplicates -> DUPLICATE, never re-applied).
- Sync batches are ALL-OR-NOTHING: one transaction per batch. An operation that
  fails validation twice goes to quarantine (status REJECTED + email alert) and
  the rest of the batch proceeds. Never partially apply a batch silently.
- Sync envelopes are versioned (`type`, `version`, `payload`); the server accepts
  older versions and normalizes. Never break an envelope shape in place.
- Route planning reserves stock: `ROUTE_LOAD` movement at plan time. Cancelling a
  route emits the inverse movement.
- A settlement with a mismatch still closes, recording the difference and reason.
  Never block a settlement.
- Field mistakes are corrected by ADMIN-issued inverse movements from the web,
  never by editing or deleting synced records.
- All timestamps are `timestamptz` in UTC. Business days (`routes.date`,
  `orders.delivery_date`) are calendar `date` in America/Lima; convert at the
  edges, never store local time in a timestamp.

## Workflow

- Domain logic is TDD: acceptance criteria in spec §2.4 (Gherkin) become tests first.
- Small diffs. Conventional Commits. PR + green CI before merge; squash to `main`.
- Migrations are expand/contract; merges containing migrations happen outside
  08:00–20:00 America/Lima.
- Don't add dependencies without asking. Don't read or write `.env*` files.
- Don't force-push. Don't edit applied migrations.
