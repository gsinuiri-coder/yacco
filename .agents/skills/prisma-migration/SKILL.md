---
name: prisma-migration
description: Discipline for any change to the Prisma schema or a migration.
  Use whenever adding, renaming or removing a model, field, enum or
  constraint in `apps/api/prisma/schema.prisma`.
---

# Prisma migration discipline

## Naming (respects spec §3.5 while keeping an idiomatic TS client)

- Prisma models: `PascalCase` (e.g. `ContainerMovement`).
- Prisma fields: `camelCase` (e.g. `occurredAt`).
- Map every model and field to the DB with `@@map("snake_case_plural")` /
  `@map("snake_case")`. The database stays `snake_case` (tables plural,
  columns singular concept) per spec §3.5; the generated client stays
  idiomatic TypeScript.
- Enum values: `SCREAMING_SNAKE_CASE`, mapped 1:1 — no translation needed
  since Postgres enum labels are already screaming-snake.
- Money columns: `Decimal @db.Decimal(10, 2)`. Never `Float`.
- Timestamps: `DateTime @db.Timestamptz` for events; `DateTime @db.Date` for
  business days (`routes.date`, `orders.delivery_date`) — see D-15.

## Expand/contract, always

1. **Expand**: add the new column/table nullable or with a default; deploy;
   backfill.
2. **Migrate reads/writes** to the new shape in application code; deploy.
3. **Contract**: drop the old column/constraint in a later migration, once
   nothing reads it.
   Never do an in-place rename or a destructive change in a single migration
   that also ships the code depending on it.

## Checklist before opening a PR with a schema change

- [ ] `pnpm prisma:validate` passes.
- [ ] `prisma migrate dev` generated a migration file that is committed and
      matches the current `schema.prisma` (no drift).
- [ ] The migration does not edit or delete a file under
      `apps/api/prisma/migrations/` that has already been applied anywhere
      (local, demo or prod). Never edit an applied migration — write a new
      one.
- [ ] Every new table/column has the `@map`/`@@map` pair if its Prisma name
      differs from its DB name.
- [ ] `CHECK` constraints and indexes from spec §3.5 are present for the
      model being touched.
- [ ] If the migration ships with other app code, the merge happens outside
      the 08:00–20:00 America/Lima deployment window.
