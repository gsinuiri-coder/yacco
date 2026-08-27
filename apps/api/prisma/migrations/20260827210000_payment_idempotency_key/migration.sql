-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "idempotency_key" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");
