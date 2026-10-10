-- AlterTable
ALTER TABLE "customer_locations" ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6);

ALTER TABLE "customer_locations"
ADD CONSTRAINT "customer_locations_latitude_range_check"
CHECK ("latitude" BETWEEN -90 AND 90),
ADD CONSTRAINT "customer_locations_longitude_range_check"
CHECK ("longitude" BETWEEN -180 AND 180);
