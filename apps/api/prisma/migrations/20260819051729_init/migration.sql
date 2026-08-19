-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'SELLER', 'DRIVER');

-- CreateEnum
CREATE TYPE "product_type" AS ENUM ('REFILL', 'CONTAINER_SALE');

-- CreateEnum
CREATE TYPE "container_movement_type" AS ENUM ('FLEET_ENTRY', 'FILLING', 'ROUTE_LOAD', 'LOAN_DELIVERY', 'EMPTY_PICKUP', 'FULL_RETURN', 'EMPTY_UNLOAD', 'FULL_SALE', 'DAMAGE_WRITE_OFF', 'LOSS_WRITE_OFF');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING', 'ON_ROUTE', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "route_status" AS ENUM ('PLANNED', 'IN_PROGRESS', 'FINISHED', 'SETTLED');

-- CreateEnum
CREATE TYPE "stop_status" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "stop_origin" AS ENUM ('ORDER', 'VAN_SALE');

-- CreateEnum
CREATE TYPE "sync_operation_status" AS ENUM ('APPLIED', 'DUPLICATE', 'REJECTED');

-- CreateEnum
CREATE TYPE "weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" "user_role" NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "delivery_days" "weekday"[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "container_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "container_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "zone_id" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "address_reference" TEXT NOT NULL,
    "credit_limit" DECIMAL(10,2),
    "debt_balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "container_type_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "product_type" NOT NULL,
    "list_price" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_prices" (
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "customer_prices_pkey" PRIMARY KEY ("customer_id","product_id")
);

-- CreateTable
CREATE TABLE "production_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "filled_by" UUID NOT NULL,
    "notes" TEXT,

    CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "container_type_id" UUID NOT NULL,
    "produced_qty" INTEGER NOT NULL,
    "available_qty" INTEGER NOT NULL,

    CONSTRAINT "batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "container_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "type" "container_movement_type" NOT NULL,
    "container_type_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "customer_id" UUID,
    "batch_id" UUID,
    "stop_id" UUID,
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "container_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_container_balances" (
    "customer_id" UUID NOT NULL,
    "container_type_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_container_balances_pkey" PRIMARY KEY ("customer_id","container_type_id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "delivery_date" DATE NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "date" DATE NOT NULL,
    "driver_id" UUID NOT NULL,
    "zone_id" UUID,
    "status" "route_status" NOT NULL DEFAULT 'PLANNED',

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_loads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "route_id" UUID NOT NULL,
    "batch_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "route_loads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "route_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "origin" "stop_origin" NOT NULL,
    "order_id" UUID,
    "status" "stop_status" NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "stop_id" UUID,
    "sold_at" TIMESTAMPTZ(6) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "credit_limit_exceeded" BOOLEAN NOT NULL DEFAULT false,
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "sale_id" UUID,
    "stop_id" UUID,
    "payment_method_id" UUID NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "recorded_by" UUID NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_settlements" (
    "route_id" UUID NOT NULL,
    "full_out" INTEGER NOT NULL,
    "full_delivered" INTEGER NOT NULL,
    "full_sold" INTEGER NOT NULL,
    "full_returned" INTEGER NOT NULL,
    "empties_collected" INTEGER NOT NULL,
    "total_sold" DECIMAL(10,2) NOT NULL,
    "total_collected" DECIMAL(10,2) NOT NULL,
    "total_on_credit" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "settled_by" UUID NOT NULL,
    "settled_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "route_settlements_pkey" PRIMARY KEY ("route_id")
);

-- CreateTable
CREATE TABLE "evidences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stop_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "synced" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "evidences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_operations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "operation_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "client_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "sync_operation_status" NOT NULL,

    CONSTRAINT "sync_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "container_types_name_key" ON "container_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_name_key" ON "payment_methods"("name");

-- CreateIndex
CREATE UNIQUE INDEX "production_batches_code_key" ON "production_batches"("code");

-- CreateIndex
CREATE INDEX "container_movements_customer_id_occurred_at_idx" ON "container_movements"("customer_id", "occurred_at");

-- CreateIndex
CREATE INDEX "orders_status_delivery_date_idx" ON "orders"("status", "delivery_date");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_order_id_key" ON "route_stops"("order_id");

-- CreateIndex
CREATE INDEX "route_stops_route_id_position_idx" ON "route_stops"("route_id", "position");

-- CreateIndex
CREATE INDEX "payments_paid_at_payment_method_id_idx" ON "payments"("paid_at", "payment_method_id");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_container_type_id_fkey" FOREIGN KEY ("container_type_id") REFERENCES "container_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_filled_by_fkey" FOREIGN KEY ("filled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_container_type_id_fkey" FOREIGN KEY ("container_type_id") REFERENCES "container_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_movements" ADD CONSTRAINT "container_movements_container_type_id_fkey" FOREIGN KEY ("container_type_id") REFERENCES "container_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_movements" ADD CONSTRAINT "container_movements_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_movements" ADD CONSTRAINT "container_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_movements" ADD CONSTRAINT "container_movements_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "route_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_movements" ADD CONSTRAINT "container_movements_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_container_balances" ADD CONSTRAINT "customer_container_balances_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_container_balances" ADD CONSTRAINT "customer_container_balances_container_type_id_fkey" FOREIGN KEY ("container_type_id") REFERENCES "container_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_loads" ADD CONSTRAINT "route_loads_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_loads" ADD CONSTRAINT "route_loads_batch_item_id_fkey" FOREIGN KEY ("batch_item_id") REFERENCES "batch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "route_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "route_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_settlements" ADD CONSTRAINT "route_settlements_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_settlements" ADD CONSTRAINT "route_settlements_settled_by_fkey" FOREIGN KEY ("settled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "route_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written section (spec §3.5 "Decisiones de diseño de datos"): CHECK
-- constraints and the partial FIFO index, which Prisma cannot express in the
-- schema. Prisma Migrate does not manage these objects, so they cause no drift.

-- CheckConstraint: positive quantities on detail lines, loads and ledger movements
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "route_loads" ADD CONSTRAINT "route_loads_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "container_movements" ADD CONSTRAINT "container_movements_quantity_check" CHECK ("quantity" > 0);

-- CheckConstraint: batch availability stays within what was produced
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_available_qty_check" CHECK ("available_qty" >= 0 AND "available_qty" <= "produced_qty");

-- CheckConstraint: materialized container balances never go negative
ALTER TABLE "customer_container_balances" ADD CONSTRAINT "customer_container_balances_quantity_check" CHECK ("quantity" >= 0);

-- CreateIndex (partial): FIFO lookup of batches with remaining stock per
-- container type; FIFO order itself comes from production_batches.date
CREATE INDEX "batch_items_container_type_id_available_idx" ON "batch_items"("container_type_id") WHERE "available_qty" > 0;
