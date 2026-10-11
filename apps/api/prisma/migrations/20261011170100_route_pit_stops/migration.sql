-- CreateTable
CREATE TABLE "route_pit_stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "route_id" UUID NOT NULL,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "cash_expected" DECIMAL(10,2),
    "cash_delivered" DECIMAL(10,2),
    "cash_reason" TEXT,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by" UUID,
    "void_reason" TEXT,

    CONSTRAINT "route_pit_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_pit_stop_counts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pit_stop_id" UUID NOT NULL,
    "container_type_id" UUID NOT NULL,
    "expected_full" INTEGER NOT NULL,
    "counted_full" INTEGER NOT NULL,
    "expected_empty" INTEGER NOT NULL,
    "counted_empty" INTEGER NOT NULL,
    "difference_reason" TEXT,

    CONSTRAINT "route_pit_stop_counts_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "container_movements" ADD COLUMN "pit_stop_id" UUID;

-- AlterTable
ALTER TABLE "route_loads" ADD COLUMN "pit_stop_id" UUID;

-- AlterTable
ALTER TABLE "route_settlements" ADD COLUMN "total_cash_delivered_in_pits" DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "route_pit_stops_route_id_created_at_idx" ON "route_pit_stops"("route_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "route_pit_stop_counts_pit_stop_id_container_type_id_key" ON "route_pit_stop_counts"("pit_stop_id", "container_type_id");

-- AddForeignKey
ALTER TABLE "route_pit_stops" ADD CONSTRAINT "route_pit_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_pit_stops" ADD CONSTRAINT "route_pit_stops_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_pit_stops" ADD CONSTRAINT "route_pit_stops_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_pit_stop_counts" ADD CONSTRAINT "route_pit_stop_counts_pit_stop_id_fkey" FOREIGN KEY ("pit_stop_id") REFERENCES "route_pit_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_pit_stop_counts" ADD CONSTRAINT "route_pit_stop_counts_container_type_id_fkey" FOREIGN KEY ("container_type_id") REFERENCES "container_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_movements" ADD CONSTRAINT "container_movements_pit_stop_id_fkey" FOREIGN KEY ("pit_stop_id") REFERENCES "route_pit_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_loads" ADD CONSTRAINT "route_loads_pit_stop_id_fkey" FOREIGN KEY ("pit_stop_id") REFERENCES "route_pit_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints: voided_at, voided_by, void_reason all or none
ALTER TABLE "route_pit_stops" ADD CONSTRAINT "route_pit_stops_voided_at_voided_by_check" CHECK (("voided_at" IS NULL) = ("voided_by" IS NULL));
ALTER TABLE "route_pit_stops" ADD CONSTRAINT "route_pit_stops_voided_at_void_reason_check" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL));
