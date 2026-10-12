-- CreateEnum
CREATE TYPE "maquila_movement_type" AS ENUM (
    'RECEIVED',
    'FILLED',
    'RETURNED',
    'RECEIVED_VOID',
    'FILLED_VOID',
    'RETURNED_VOID'
);

-- CreateTable
CREATE TABLE "maquila_balances" (
    "customer_id" UUID NOT NULL,
    "container_type_id" UUID NOT NULL,
    "empty_at_plant" INTEGER NOT NULL DEFAULT 0,
    "full_to_return" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "maquila_balances_pkey" PRIMARY KEY ("customer_id","container_type_id")
);

-- CreateTable
CREATE TABLE "maquila_container_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "container_type_id" UUID NOT NULL,
    "type" "maquila_movement_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sale_id" UUID,
    "reverses_movement_id" UUID,
    "reason" TEXT,
    "recorded_by" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maquila_container_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "maquila_container_movements_reverses_movement_id_key" ON "maquila_container_movements"("reverses_movement_id");

-- CreateIndex
CREATE INDEX "maquila_container_movements_customer_id_occurred_at_idx" ON "maquila_container_movements"("customer_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "maquila_balances" ADD CONSTRAINT "maquila_balances_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maquila_balances" ADD CONSTRAINT "maquila_balances_container_type_id_fkey" FOREIGN KEY ("container_type_id") REFERENCES "container_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maquila_container_movements" ADD CONSTRAINT "maquila_container_movements_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maquila_container_movements" ADD CONSTRAINT "maquila_container_movements_container_type_id_fkey" FOREIGN KEY ("container_type_id") REFERENCES "container_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maquila_container_movements" ADD CONSTRAINT "maquila_container_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maquila_container_movements" ADD CONSTRAINT "maquila_container_movements_reverses_movement_id_fkey" FOREIGN KEY ("reverses_movement_id") REFERENCES "maquila_container_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maquila_container_movements" ADD CONSTRAINT "maquila_container_movements_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraints
ALTER TABLE "maquila_balances" ADD CONSTRAINT "maquila_balances_empty_at_plant_check"
    CHECK ("empty_at_plant" >= 0);

ALTER TABLE "maquila_balances" ADD CONSTRAINT "maquila_balances_full_to_return_check"
    CHECK ("full_to_return" >= 0);

ALTER TABLE "maquila_container_movements" ADD CONSTRAINT "maquila_container_movements_quantity_check"
    CHECK ("quantity" > 0);
