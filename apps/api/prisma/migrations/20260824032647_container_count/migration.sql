-- CreateTable
CREATE TABLE "container_counts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "container_type_id" UUID NOT NULL,
    "counted_at" TIMESTAMPTZ(6) NOT NULL,
    "counted_quantity" INTEGER NOT NULL,
    "expected_quantity" INTEGER NOT NULL,
    "adjustment_id" UUID,
    "counted_by" UUID NOT NULL,

    CONSTRAINT "container_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "container_counts_adjustment_id_key" ON "container_counts"("adjustment_id");

-- CreateIndex
CREATE INDEX "container_counts_location_id_container_type_id_counted_at_idx" ON "container_counts"("location_id", "container_type_id", "counted_at");

-- AddForeignKey
ALTER TABLE "container_counts" ADD CONSTRAINT "container_counts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_counts" ADD CONSTRAINT "container_counts_container_type_id_fkey" FOREIGN KEY ("container_type_id") REFERENCES "container_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_counts" ADD CONSTRAINT "container_counts_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "container_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "container_counts" ADD CONSTRAINT "container_counts_counted_by_fkey" FOREIGN KEY ("counted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
