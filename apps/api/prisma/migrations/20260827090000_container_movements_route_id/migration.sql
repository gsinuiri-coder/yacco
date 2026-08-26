-- AlterTable
ALTER TABLE "container_movements" ADD COLUMN     "route_id" UUID;

-- CreateIndex
CREATE INDEX "container_movements_route_id_occurred_at_idx" ON "container_movements"("route_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "container_movements" ADD CONSTRAINT "container_movements_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
