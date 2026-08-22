-- Makes the direction of every container movement explicit instead of
-- deducing it from `type`. That deduction broke once damage could happen
-- both at the plant and on the route, and a sale could leave from either
-- place too: `type` alone no longer determines where the quantity comes
-- from or goes to.
--
-- `container_movements` is an append-only ledger (spec: never UPDATE/DELETE)
-- and is empty in every environment this migration will ever run against —
-- there is nothing to backfill. The DO block below verifies that instead of
-- assuming it, so this fails loudly if it is ever wrong.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "container_movements") THEN
    RAISE EXCEPTION 'container_movements is not empty; this migration has no backfill for fromState/toState on existing rows';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "container_state" AS ENUM ('EMPTY_AT_PLANT', 'FULL_AT_PLANT', 'FULL_ON_ROUTE', 'EMPTY_ON_ROUTE', 'WITH_CUSTOMER');

-- AlterTable
ALTER TABLE "container_movements"
  ADD COLUMN "from_state" "container_state",
  ADD COLUMN "to_state" "container_state";

-- Hand-written (spec §3.5 "Decisiones de diseño de datos" pattern): a
-- movement with no origin AND no destination is not a movement at all — one
-- side crossing the fleet's boundary (a fleet entry or an exit) is the only
-- way either side is ever null. Belt and suspenders on top of the service's
-- own transition-matrix validation, exactly like container_movements_quantity_check
-- already backs the DTO's own >0 check.
ALTER TABLE "container_movements" ADD CONSTRAINT "container_movements_state_check" CHECK ("from_state" IS NOT NULL OR "to_state" IS NOT NULL);
