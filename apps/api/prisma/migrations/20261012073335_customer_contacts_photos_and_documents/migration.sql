-- CreateEnum
CREATE TYPE "location_photo_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "coordinate_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "document_number" VARCHAR(30),
ADD COLUMN     "document_type" VARCHAR(20),
ADD COLUMN     "fiscal_address" TEXT,
ADD COLUMN     "legal_name" TEXT;

-- CreateTable
CREATE TABLE "customer_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_by" UUID,
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_location_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "location_photo_status" NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "hidden_by" UUID,
    "hidden_at" TIMESTAMPTZ(6),
    "hidden_reason" TEXT,

    CONSTRAINT "customer_location_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_location_coordinate_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "location_id" UUID NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "accuracy_m" DECIMAL(10,2),
    "previous_latitude" DECIMAL(9,6),
    "previous_longitude" DECIMAL(9,6),
    "status" "coordinate_request_status" NOT NULL,
    "requested_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,

    CONSTRAINT "customer_location_coordinate_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_contacts_customer_id_active_idx" ON "customer_contacts"("customer_id", "active");

-- CreateIndex
CREATE INDEX "customer_location_photos_location_id_status_idx" ON "customer_location_photos"("location_id", "status");

-- CreateIndex
CREATE INDEX "customer_location_coordinate_requests_location_id_status_idx" ON "customer_location_coordinate_requests"("location_id", "status");

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_removed_by_fkey" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_location_photos" ADD CONSTRAINT "customer_location_photos_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_location_photos" ADD CONSTRAINT "customer_location_photos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_location_photos" ADD CONSTRAINT "customer_location_photos_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_location_photos" ADD CONSTRAINT "customer_location_photos_hidden_by_fkey" FOREIGN KEY ("hidden_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_location_coordinate_requests" ADD CONSTRAINT "customer_location_coordinate_requests_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "customer_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_location_coordinate_requests" ADD CONSTRAINT "customer_location_coordinate_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_location_coordinate_requests" ADD CONSTRAINT "customer_location_coordinate_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written check constraints (spec invariants & range validation)
ALTER TABLE "customer_location_coordinate_requests"
ADD CONSTRAINT "customer_location_coordinate_requests_latitude_range_check"
CHECK ("latitude" BETWEEN -90 AND 90),
ADD CONSTRAINT "customer_location_coordinate_requests_longitude_range_check"
CHECK ("longitude" BETWEEN -180 AND 180),
ADD CONSTRAINT "customer_location_coordinate_requests_previous_latitude_range_check"
CHECK ("previous_latitude" IS NULL OR "previous_latitude" BETWEEN -90 AND 90),
ADD CONSTRAINT "customer_location_coordinate_requests_previous_longitude_range_check"
CHECK ("previous_longitude" IS NULL OR "previous_longitude" BETWEEN -180 AND 180);

ALTER TABLE "customer_location_photos"
ADD CONSTRAINT "customer_location_photos_hidden_audit_check"
CHECK (
  ("hidden_by" IS NULL AND "hidden_at" IS NULL AND "hidden_reason" IS NULL) OR
  ("hidden_by" IS NOT NULL AND "hidden_at" IS NOT NULL AND "hidden_reason" IS NOT NULL)
);

ALTER TABLE "customer_contacts"
ADD CONSTRAINT "customer_contacts_removed_audit_check"
CHECK (
  ("removed_by" IS NULL AND "removed_at" IS NULL) OR
  ("removed_by" IS NOT NULL AND "removed_at" IS NOT NULL)
);

