-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "rejected_at" TIMESTAMPTZ(6),
ADD COLUMN     "rejected_by" UUID,
ADD COLUMN     "rejection_reason" TEXT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma cannot express a CHECK constraint in the schema, same
-- case as container_counts_counted_quantity_check and this table's own
-- payments_status_confirmed_at_check): status and the rejection fields must
-- agree, in both directions — a REJECTED row always carries its rejectedAt,
-- rejectedBy AND rejectionReason, and no other status ever does. No backfill
-- needed: REJECTED did not exist before this PR (added standalone in
-- 20260827150000_payment_status_rejected, since Postgres refuses to use a
-- brand-new enum value in the same transaction that adds it), so there is no
-- existing row this status could apply to.
--
-- rejectedBy IS checked here, unlike confirmedById on
-- payments_status_confirmed_at_check: a cash payment can be auto-CONFIRMED
-- with no human confirmer (nobody separately "confirmed" it), but there is
-- no equivalent auto-REJECTED path — every rejection is an explicit ADMIN
-- decision, so rejectedBy is always known and always required.
--
-- payments_status_confirmed_at_check (already applied, untouched) still
-- holds with REJECTED in the mix: for a REJECTED row, status <> 'CONFIRMED'
-- and confirmed_at is NULL, so both sides of that check read false.
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_rejected_at_check" CHECK (("status" = 'REJECTED') = ("rejected_at" IS NOT NULL));
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_rejected_by_check" CHECK (("status" = 'REJECTED') = ("rejected_by" IS NOT NULL));
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_rejection_reason_check" CHECK (("status" = 'REJECTED') = ("rejection_reason" IS NOT NULL));
