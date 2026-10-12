-- CreateEnum
CREATE TYPE "accessory_movement_type" AS ENUM (
    'ENTRY',
    'SALE',
    'SALE_VOID',
    'LOAN',
    'LOAN_VOID',
    'LOAN_RETURN',
    'LOAN_RETURN_VOID',
    'LOAN_CHARGE',
    'LOAN_CHARGE_VOID',
    'WRITE_OFF',
    'COUNT_ADJUSTMENT'
);

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "container_type_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "accessory_stock" (
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "accessory_stock_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "customer_accessory_balances" (
    "location_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_accessory_balances_pkey" PRIMARY KEY ("location_id","product_id")
);

-- CreateTable
CREATE TABLE "accessory_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "type" "accessory_movement_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "location_id" UUID,
    "sale_id" UUID,
    "reason" TEXT,
    "reverses_movement_id" UUID,
    "recorded_by" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accessory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accessory_counts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "expected_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER NOT NULL,
    "reason" TEXT,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accessory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accessory_movements_reverses_movement_id_key" ON "accessory_movements"("reverses_movement_id");

-- CreateIndex
CREATE INDEX "accessory_movements_product_id_occurred_at_idx" ON "accessory_movements"("product_id", "occurred_at");

-- CreateIndex
CREATE INDEX "accessory_movements_location_id_occurred_at_idx" ON "accessory_movements"("location_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "accessory_stock" ADD CONSTRAINT "accessory_stock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_accessory_balances" ADD CONSTRAINT "customer_accessory_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_accessory_balances" ADD CONSTRAINT "customer_accessory_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_movements" ADD CONSTRAINT "accessory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_movements" ADD CONSTRAINT "accessory_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_movements" ADD CONSTRAINT "accessory_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_movements" ADD CONSTRAINT "accessory_movements_reverses_movement_id_fkey" FOREIGN KEY ("reverses_movement_id") REFERENCES "accessory_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_movements" ADD CONSTRAINT "accessory_movements_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_counts" ADD CONSTRAINT "accessory_counts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accessory_counts" ADD CONSTRAINT "accessory_counts_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraints
ALTER TABLE "products" ADD CONSTRAINT "products_accessory_container_type_check"
    CHECK (("type" = 'ACCESSORY' AND "container_type_id" IS NULL) OR ("type" <> 'ACCESSORY' AND "container_type_id" IS NOT NULL));

ALTER TABLE "customer_accessory_balances" ADD CONSTRAINT "customer_accessory_balances_quantity_check"
    CHECK ("quantity" >= 0);

ALTER TABLE "accessory_movements" ADD CONSTRAINT "accessory_movements_quantity_check"
    CHECK ("quantity" > 0);
