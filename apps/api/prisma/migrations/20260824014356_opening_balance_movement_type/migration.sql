-- Adds the movement type the customer-roster loader uses to seed each
-- customer's opening container balance from the paper ledger.
--
-- Postgres does not allow a newly added enum value to be used inside the
-- same transaction that added it, so this migration ONLY adds the value —
-- nothing in this migration (or the app code that ships with it) may
-- reference OPENING_BALANCE yet.
-- AlterEnum
ALTER TYPE "container_movement_type" ADD VALUE 'OPENING_BALANCE';
