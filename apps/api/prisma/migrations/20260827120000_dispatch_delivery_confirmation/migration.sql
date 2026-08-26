-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'CONFIRMED');

-- AlterTable
ALTER TABLE "payment_methods" ADD COLUMN     "requires_confirmation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "confirmed_at" TIMESTAMPTZ(6),
ADD COLUMN     "confirmed_by" UUID,
ADD COLUMN     "status" "payment_status" NOT NULL DEFAULT 'CONFIRMED';

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "price_override_authorized_by" UUID;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_price_override_authorized_by_fkey" FOREIGN KEY ("price_override_authorized_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every payment that already exists was recorded before this
-- column existed, i.e. before a PENDING state was even possible — it is
-- money the system has always treated as settled. Stamping confirmedAt with
-- the payment's own paidAt says exactly that (nobody separately "confirmed"
-- it; it was never anything but confirmed), and satisfies the CHECK below
-- before it's added.
UPDATE "payments" SET "confirmed_at" = "paid_at" WHERE "confirmed_at" IS NULL;

-- Hand-written (Prisma cannot express a CHECK constraint in the schema, same
-- reason as container_counts_counted_quantity_check): status and
-- confirmedAt must agree. confirmedById is deliberately NOT part of this
-- check — an auto-confirmed cash payment has no separate confirmer, only
-- whoever recorded it; a human "confirmedBy" only exists once the payments
-- module adds a real confirmation action.
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_confirmed_at_check" CHECK (("status" = 'CONFIRMED') = ("confirmed_at" IS NOT NULL));
