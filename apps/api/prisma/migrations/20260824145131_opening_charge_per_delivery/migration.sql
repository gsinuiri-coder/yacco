-- The paper ledger turned out to carry the opening debt per unpaid delivery,
-- not as one net figure per customer: a customer can owe five deliveries,
-- each with its own date and its own outstanding balance. Loading the net
-- would throw away that age, which is exactly what "oldest debt is paid
-- first" needs. So the "one opening charge per customer" rule this index
-- enforced (only partially — see 20260824061020_opening_balance_indexes) is
-- dropped on purpose: a customer now has as many opening charges as unpaid
-- deliveries. What replaces the guarantee is `external_id` below: the
-- duplicate the index used to prevent (the loader run twice) is now caught
-- by the natural key of the source record, per delivery instead of per
-- customer. payments_opening_balance_customer_key stays: one opening credit
-- per customer is still the rule.
DROP INDEX "sales_opening_balance_location_key";

-- AlterTable
-- Reference to the record in the system of origin this sale was imported
-- from. It is what makes the roster loader safe to run again: without a
-- natural external key, a second pass would create every opening charge
-- anew. Nullable because the normal sales S4 will register come from no
-- import at all.
ALTER TABLE "sales" ADD COLUMN     "external_id" TEXT;

-- Hand-written partial index (Prisma cannot express one in the schema):
-- unique only where present, so the nulls of every ordinary sale never
-- collide with each other.
CREATE UNIQUE INDEX "sales_external_id_key"
  ON "sales" ("external_id") WHERE "external_id" IS NOT NULL;
