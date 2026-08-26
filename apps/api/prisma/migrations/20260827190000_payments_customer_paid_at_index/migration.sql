-- CreateIndex
CREATE INDEX "payments_customer_id_paid_at_idx" ON "payments"("customer_id", "paid_at" DESC);
