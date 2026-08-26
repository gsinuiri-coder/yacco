-- Adds external_code to customers and customer_locations: the key the
-- roster loader (reading the snapshot from tools/firestore-export) will
-- match against on re-runs, so re-loading the same source document never
-- creates a duplicate row.
--
-- Nullable on purpose: a customer or location created from the web has no
-- external system to key off, and must stay valid without one.
--
-- Just a plain UNIQUE index, NOT a hand-written partial one. Unlike
-- customer_locations_one_primary_per_customer (partial over a NOT NULL
-- boolean, where every row participates and a plain UNIQUE would wrongly
-- cap the table at one non-primary row), a UNIQUE constraint on a single
-- nullable column already excludes NULL from Postgres's duplicate check —
-- ordinary SQL semantics, not a Postgres extension. So any number of
-- web-created rows can share external_code = NULL while two loader-created
-- rows with the same non-null code collide, which is exactly what's wanted.
-- This also has to match schema.prisma's plain `@unique` exactly (that's
-- what `prisma migrate diff` produces below), or `prisma migrate dev`
-- would see drift between the migration history and the schema and want to
-- generate a second migration to reconcile them.
ALTER TABLE "customers" ADD COLUMN "external_code" TEXT;
ALTER TABLE "customer_locations" ADD COLUMN "external_code" TEXT;

CREATE UNIQUE INDEX "customers_external_code_key" ON "customers"("external_code");
CREATE UNIQUE INDEX "customer_locations_external_code_key" ON "customer_locations"("external_code");
