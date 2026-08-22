-- Introduces CustomerLocation: a customer can have several physical
-- locations, and everything below the customer (orders, route stops, the
-- container ledger/balances, sales) hangs off the location where it actually
-- happens rather than off the customer directly. Contact/address fields move
-- off customers entirely (never duplicated in both places).
--
-- This runs as ONE migration against a base that already has rows, per
-- explicit product decision: the database has no real data yet (the initial
-- load of ~500 customers/750 containers hasn't happened), so this is the
-- cheap window to do it in a single step rather than expand/contract across
-- releases. Order matters throughout: nullable add -> backfill -> NOT NULL ->
-- drop old column, never the reverse (NOT NULL before the backfill would
-- fail against a base that already has rows).

-- CreateTable
CREATE TABLE "customer_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "address_reference" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_locations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill step 1: give every existing customer its "Principal" location,
-- copying the address/reference/phone it has today. `active` is left at its
-- own default (true) rather than copied from the customer: a location's own
-- active flag is a separate, forward-looking concept (this specific site
-- stopped operating) from the customer's (this whole account stopped being
-- served), and conflating them here would misrepresent a deactivated
-- customer's location as itself having been closed down.
INSERT INTO "customer_locations" ("customer_id", "name", "address", "address_reference", "phone", "is_primary")
SELECT "id", 'Principal', "address", "address_reference", "phone", true
FROM "customers";

-- Hand-written (Prisma cannot express a partial index in the schema, same
-- reason the FIFO index at the bottom of the init migration is hand-written):
-- exactly one primary location per customer. A plain UNIQUE("customer_id",
-- "is_primary") would also cap a customer at exactly one NON-primary
-- location, since every such row shares is_primary = false — this has to be
-- partial, over is_primary = true only.
CREATE UNIQUE INDEX "customer_locations_one_primary_per_customer" ON "customer_locations"("customer_id") WHERE "is_primary" = true;

-- Backfill step 2: repoint every existing row at the customer's new primary
-- location, then make the column NOT NULL, then drop the old customer_id.
-- Every customer_id here already satisfies a NOT NULL FK into "customers",
-- and step 1 just gave every customer a primary location, so the UPDATE
-- leaves no row unmatched.

-- AlterTable: orders
ALTER TABLE "orders" ADD COLUMN "location_id" UUID;
UPDATE "orders" AS o
SET "location_id" = cl."id"
FROM "customer_locations" cl
WHERE cl."customer_id" = o."customer_id" AND cl."is_primary" = true;
ALTER TABLE "orders" ALTER COLUMN "location_id" SET NOT NULL;
ALTER TABLE "orders" DROP CONSTRAINT "orders_customer_id_fkey";
ALTER TABLE "orders" DROP COLUMN "customer_id";
ALTER TABLE "orders" ADD CONSTRAINT "orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: route_stops
ALTER TABLE "route_stops" ADD COLUMN "location_id" UUID;
UPDATE "route_stops" AS rs
SET "location_id" = cl."id"
FROM "customer_locations" cl
WHERE cl."customer_id" = rs."customer_id" AND cl."is_primary" = true;
ALTER TABLE "route_stops" ALTER COLUMN "location_id" SET NOT NULL;
ALTER TABLE "route_stops" DROP CONSTRAINT "route_stops_customer_id_fkey";
ALTER TABLE "route_stops" DROP COLUMN "customer_id";
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: container_movements (customer_id was optional and stays
-- optional as location_id — plant-side movements like FLEET_ENTRY/FILLING
-- never touch a customer or a location).
ALTER TABLE "container_movements" ADD COLUMN "location_id" UUID;
UPDATE "container_movements" AS cm
SET "location_id" = cl."id"
FROM "customer_locations" cl
WHERE cl."customer_id" = cm."customer_id" AND cl."is_primary" = true AND cm."customer_id" IS NOT NULL;
ALTER TABLE "container_movements" DROP CONSTRAINT "container_movements_customer_id_fkey";
-- Dropping the column also drops the index below it (Postgres drops any
-- index that depends solely on a dropped column), so there is nothing left
-- to DROP INDEX afterward — only the new one needs creating.
ALTER TABLE "container_movements" DROP COLUMN "customer_id";
ALTER TABLE "container_movements" ADD CONSTRAINT "container_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "container_movements_location_id_occurred_at_idx" ON "container_movements"("location_id", "occurred_at");

-- AlterTable: customer_container_balances (composite PK swap — this ledger
-- balance lives at the location with no customer-wide tier to preserve,
-- unlike customer_prices below, so it is a straight column rename in effect).
ALTER TABLE "customer_container_balances" ADD COLUMN "location_id" UUID;
UPDATE "customer_container_balances" AS ccb
SET "location_id" = cl."id"
FROM "customer_locations" cl
WHERE cl."customer_id" = ccb."customer_id" AND cl."is_primary" = true;
ALTER TABLE "customer_container_balances" ALTER COLUMN "location_id" SET NOT NULL;
ALTER TABLE "customer_container_balances" DROP CONSTRAINT "customer_container_balances_pkey";
ALTER TABLE "customer_container_balances" DROP CONSTRAINT "customer_container_balances_customer_id_fkey";
ALTER TABLE "customer_container_balances" DROP COLUMN "customer_id";
ALTER TABLE "customer_container_balances" ADD CONSTRAINT "customer_container_balances_pkey" PRIMARY KEY ("location_id", "container_type_id");
ALTER TABLE "customer_container_balances" ADD CONSTRAINT "customer_container_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: sales
ALTER TABLE "sales" ADD COLUMN "location_id" UUID;
UPDATE "sales" AS s
SET "location_id" = cl."id"
FROM "customer_locations" cl
WHERE cl."customer_id" = s."customer_id" AND cl."is_primary" = true;
ALTER TABLE "sales" ALTER COLUMN "location_id" SET NOT NULL;
ALTER TABLE "sales" DROP CONSTRAINT "sales_customer_id_fkey";
ALTER TABLE "sales" DROP COLUMN "customer_id";
ALTER TABLE "sales" ADD CONSTRAINT "sales_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: customer_prices — customer_id is UNCHANGED (the price
-- agreement is with the customer); location_id is added as an OPTIONAL
-- override for one branch. The old (customer_id, product_id) composite PK
-- cannot survive this: once a location-specific row may coexist with the
-- customer-wide one for the same product, that pair is no longer unique on
-- its own, so a surrogate id replaces it. Two partial unique indexes take
-- over what the composite PK used to guarantee, one per price tier.
ALTER TABLE "customer_prices" ADD COLUMN "location_id" UUID;
ALTER TABLE "customer_prices" ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "customer_prices" DROP CONSTRAINT "customer_prices_pkey";
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_pkey" PRIMARY KEY ("id");
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "customer_prices_base_price_key" ON "customer_prices"("customer_id", "product_id") WHERE "location_id" IS NULL;
CREATE UNIQUE INDEX "customer_prices_location_price_key" ON "customer_prices"("customer_id", "product_id", "location_id") WHERE "location_id" IS NOT NULL;

-- AlterTable: payments — customer_id is UNCHANGED (a payment always carries
-- the customer); location_id is added as an OPTIONAL pointer for the case
-- where a branch manager settles their own debt.
ALTER TABLE "payments" ADD COLUMN "location_id" UUID;
ALTER TABLE "payments" ADD CONSTRAINT "payments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill step 3: only now, with every row above repointed at a location,
-- drop the columns that live solely on customer_locations from here on.
ALTER TABLE "customers" DROP COLUMN "address";
ALTER TABLE "customers" DROP COLUMN "address_reference";
ALTER TABLE "customers" DROP COLUMN "phone";
