-- AlterTable
ALTER TABLE "route_stops"
ADD COLUMN "marked_latitude" DECIMAL(9,6),
ADD COLUMN "marked_longitude" DECIMAL(9,6),
ADD COLUMN "marked_accuracy_m" DECIMAL(10,2);

ALTER TABLE "route_stops"
ADD CONSTRAINT "route_stops_marked_latitude_range_check"
CHECK ("marked_latitude" BETWEEN -90 AND 90),
ADD CONSTRAINT "route_stops_marked_longitude_range_check"
CHECK ("marked_longitude" BETWEEN -180 AND 180),
ADD CONSTRAINT "route_stops_marked_accuracy_nonnegative_check"
CHECK ("marked_accuracy_m" >= 0),
ADD CONSTRAINT "route_stops_marked_location_complete_check"
CHECK (
  ("marked_latitude" IS NULL AND "marked_longitude" IS NULL AND "marked_accuracy_m" IS NULL)
  OR
  ("marked_latitude" IS NOT NULL AND "marked_longitude" IS NOT NULL AND "marked_accuracy_m" IS NOT NULL)
);
