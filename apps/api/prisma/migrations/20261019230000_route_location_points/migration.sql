-- CreateTable
CREATE TABLE "route_location_points" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_point_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "accuracy_m" DECIMAL(10,2),
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_location_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "route_location_points_client_point_id_key" ON "route_location_points"("client_point_id");

-- CreateIndex
CREATE INDEX "route_location_points_route_id_recorded_at_idx" ON "route_location_points"("route_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "route_location_points" ADD CONSTRAINT "route_location_points_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_location_points" ADD CONSTRAINT "route_location_points_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_location_points" ADD CONSTRAINT "route_location_points_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: Prisma cannot express CHECK constraints.
ALTER TABLE "route_location_points"
ADD CONSTRAINT "route_location_points_latitude_range_check"
CHECK ("latitude" BETWEEN -90 AND 90),
ADD CONSTRAINT "route_location_points_longitude_range_check"
CHECK ("longitude" BETWEEN -180 AND 180);
