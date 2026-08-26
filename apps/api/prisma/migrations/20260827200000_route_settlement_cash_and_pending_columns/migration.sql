-- AlterTable
-- route_settlements is empty in every environment (no route has ever been
-- settled), so these two columns are added NOT NULL with no default and no
-- backfill is needed. See the model comment in schema.prisma for why
-- totalCollected alone can't be counted against physical cash: it predates
-- PaymentStatus and mixes cash the driver holds with a Yape that might still
-- be unconfirmed.
ALTER TABLE "route_settlements"
  ADD COLUMN "total_cash_collected" DECIMAL(10,2) NOT NULL,
  ADD COLUMN "total_pending_confirmation" DECIMAL(10,2) NOT NULL;
