# CLAUDE.md — Yacco

## Project

Management system for a water purification plant in Peru (currency: soles, S/).
pnpm monorepo. **Built today:** `apps/api` (NestJS modular monolith +
Prisma/PostgreSQL), `apps/web` (React + Vite), `packages/shared` (DTO
contracts) — that is the whole of `packages/`. **Reserved, not built:**
`apps/mobile` (Expo, offline-first driver app) holds a `.gitkeep` and nothing
else, and `packages/sync-engine` (pure-TS offline queue) has no directory at
all. Both are planned scope (spec §1.3, §4.2), not code you can import or
point a reader at.
The spec at `docs/yacco-documentacion.md` is the source of truth. If code and
spec disagree, STOP and ask before proceeding.

## Language rule (non-negotiable, retroactive)

- ALL code identifiers in English: classes `PascalCase`, variables/functions
  `camelCase`, DB tables/columns `snake_case` (plural tables), enum values
  `SCREAMING_SNAKE_CASE`, REST routes `kebab-case` plural under `/api/v1`.
- Spanish ONLY for UI strings and human docs. If you find a Spanish
  identifier anywhere, rename it.

## Commands

- `pnpm demo:up` — starts Postgres via Docker Compose and waits for its
  healthcheck, applies migrations, seeds. Naming `postgres` scopes `up` to
  that service alone, so MinIO is NOT started by this command — nothing in
  the demo needs S3 evidence uploads. Bring MinIO up yourself
  (`docker compose up -d minio`) if you need it. One shot, no interaction;
  safe to run with the plant owner watching the screen.
- `pnpm dev:api` / `pnpm dev:web` — local dev, after `demo:up`. The API
  compiles first and runs the `dist/` build (`tsx` doesn't emit
  `emitDecoratorMetadata`, which Nest's DI needs). For a watch loop instead,
  run in two terminals inside `apps/api`: `pnpm dev:tsc` and `pnpm dev:node`.
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
- Business dates (`deliveryDate`, `routes.date`) are `"AAAA-MM-DD"` strings on
  the wire — a calendar day, not an instant. The front NEVER converts them
  with `new Date(...)`, `Date.parse`, or a date library: that parses as UTC
  midnight and reads back a day earlier in America/Lima (UTC-5). Format by
  splitting the string as text, the same way money is formatted without
  going through `Number`.
- Un catálogo (productos, tipos de envase, zonas, locaciones, métodos de
  pago) se lee SIEMPRE de su propio endpoint. Si no existe ese endpoint, el
  campo NO se ofrece en la UI: nunca se le pide al usuario un identificador
  que no tiene forma de conocer, ni se deriva el catálogo de otro recurso.
- Los textos de la interfaz usan el vocabulario de la planta, no jerga
  técnica ni analogías del desarrollador. Ante la duda, la palabra que usaría
  el dueño hablando con su conductor.
- Una migración ya aplicada en cualquier base —incluida la local de Docker—
  está congelada. No se edita, ni siquiera un comentario: cambiar el archivo
  rompe el checksum y `prisma migrate deploy` se niega a avanzar, lo que en
  el build de Render significa deploy fallido contra una base viva. Las
  correcciones van en una migración nueva, o el comentario se escribe en el
  código que la acompaña. Si el archivo ya se editó por error y solo afecta
  a la base local, se resuelve con `prisma migrate reset` en Docker, nunca
  tocando a mano la tabla `_prisma_migrations`.
- Every operational row records `created_at` and `recorded_by`/`created_by`.
- Route planning reserves stock: `ROUTE_LOAD` movement at plan time. Cancelling a
  route emits the inverse movement.
- A settlement with a mismatch still closes, recording the difference and reason.
  Never block a settlement.
- Finishing a route REQUIRES every stop resolved (DELIVERED or FAILED); a route
  with a PENDING stop cannot reach FINISHED. That block is state machine, not a
  business judgement: it does not contradict "warns, never blocks" — a stop left
  PENDING on a FINISHED route strands its order in ON_ROUTE with no exit.
- Once an operational record is written, a mistake in it is NEVER corrected by
  editing or deleting that row, whatever its origin: loaded from the office,
  written in the field, or arriving through a sync when that exists. The
  correction is always an inverse movement issued by ADMIN from the web. The
  rule carries no qualifier on purpose. It used to read "never by editing or
  deleting synced records", and that adjective selected nothing: there are no
  synced records today — no sync module, and `sync_operations` /
  `evidences.synced` are modelled without a line of code reading or writing
  them — while every operational row IS office-loaded (each stop through
  `PATCH /api/v1/routes/:id/stops/:stopId`). Read literally, it left an
  unsynced row editable, and unsynced is all there is.
- All timestamps are `timestamptz` in UTC. Business days (`routes.date`,
  `orders.delivery_date`) are calendar `date` in America/Lima; convert at the
  edges, never store local time in a timestamp.

## Sync protocol — agreed design, NOT built

These are not invariants: they govern no code, so nothing can violate them.
There is no sync module — `POST /api/v1/sync/operations` has no controller and
no service (only the `sync_operations` table, modelled ahead of time), and
`apps/mobile` is empty. They are the agreed shape of the protocol and they
apply WHEN that module exists. Whether the driver app gets built at all is an
open decision, taken with the plant owner. Full design in skill
`sync-protocol`; status note in spec §4.3.

- **Field writes.** TODAY a driver registers a delivery through
  `PATCH /api/v1/routes/:id/stops/:stopId`: `routes.controller.ts` declares
  `@Roles(ADMIN, SELLER, DRIVER)` at class level and that PATCH inherits it.
  In practice the office records each stop from the web — the driver dictates
  or writes on paper and someone loads it (spec §4.3). WHEN sync exists,
  driver field writes enter through `POST /api/v1/sync/operations` (idempotent
  by device-generated UUID; duplicates -> DUPLICATE, never re-applied), and
  the PATCH stays as the office path or is restricted to ADMIN/SELLER. That
  call is made together with the sync module, not before.
- Sync batches are ALL-OR-NOTHING: one transaction per batch. An operation that
  fails validation twice goes to quarantine (status REJECTED + email alert) and
  the rest of the batch proceeds. Never partially apply a batch silently.
- Sync envelopes are versioned (`type`, `version`, `payload`); the server accepts
  older versions and normalizes. Never break an envelope shape in place.

## Workflow

- Domain logic is TDD: acceptance criteria in spec §2.4 (Gherkin) become tests first.
- Small diffs. Conventional Commits. PR + green CI before merge; squash to `main`.
- Migrations are expand/contract. Merges containing migrations happen outside
  08:00–20:00 America/Lima WHILE THERE ARE REAL USERS in production. Today the
  only user is Giancarlo, so the window does not apply and is not re-decided
  on every PR; it applies again from the start of the field pilot.
- Don't add dependencies without asking. Don't read or write `.env*` files.
- Don't force-push. Don't edit applied migrations.
