CREATE TABLE "order_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" UUID,

    CONSTRAINT "order_groups_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "orders"
    ADD COLUMN "order_group_id" UUID,
    ADD COLUMN "rescheduled_from_order_id" UUID;

CREATE UNIQUE INDEX "order_groups_idempotency_key_key"
    ON "order_groups"("idempotency_key");

CREATE UNIQUE INDEX "orders_rescheduled_from_order_id_key"
    ON "orders"("rescheduled_from_order_id");

ALTER TABLE "order_groups"
    ADD CONSTRAINT "order_groups_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_groups"
    ADD CONSTRAINT "order_groups_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_order_group_id_fkey"
    FOREIGN KEY ("order_group_id") REFERENCES "order_groups"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_rescheduled_from_order_id_fkey"
    FOREIGN KEY ("rescheduled_from_order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
