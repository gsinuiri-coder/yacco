-- AlterTable
ALTER TABLE "routes" ADD COLUMN     "vehicle_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "document_number" VARCHAR(30),
ADD COLUMN     "document_type" VARCHAR(20),
ADD COLUMN     "license_category" VARCHAR(20),
ADD COLUMN     "license_expires_on" DATE,
ADD COLUMN     "license_number" VARCHAR(30);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plate" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "brand" VARCHAR(50) NOT NULL,
    "model" VARCHAR(50) NOT NULL,
    "capacity_units" INTEGER,
    "vehicle_class" VARCHAR(50),
    "circulation_card_number" VARCHAR(50),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_review_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_review_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "review_type_id" UUID NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "notes" TEXT,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by" UUID,
    "void_reason" TEXT,

    CONSTRAINT "vehicle_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_vehicle_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "route_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "pit_stop_id" UUID,

    CONSTRAINT "route_vehicle_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_review_types_name_key" ON "vehicle_review_types"("name");

-- CreateIndex
CREATE INDEX "vehicle_reviews_vehicle_id_review_type_id_ends_on_idx" ON "vehicle_reviews"("vehicle_id", "review_type_id", "ends_on");

-- CreateIndex
CREATE INDEX "route_vehicle_assignments_route_id_created_at_idx" ON "route_vehicle_assignments"("route_id", "created_at");

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_review_types" ADD CONSTRAINT "vehicle_review_types_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_reviews" ADD CONSTRAINT "vehicle_reviews_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_reviews" ADD CONSTRAINT "vehicle_reviews_review_type_id_fkey" FOREIGN KEY ("review_type_id") REFERENCES "vehicle_review_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_reviews" ADD CONSTRAINT "vehicle_reviews_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_reviews" ADD CONSTRAINT "vehicle_reviews_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_vehicle_assignments" ADD CONSTRAINT "route_vehicle_assignments_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_vehicle_assignments" ADD CONSTRAINT "route_vehicle_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_vehicle_assignments" ADD CONSTRAINT "route_vehicle_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_vehicle_assignments" ADD CONSTRAINT "route_vehicle_assignments_pit_stop_id_fkey" FOREIGN KEY ("pit_stop_id") REFERENCES "route_pit_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written check constraints (Fase 3, Fila 3)
ALTER TABLE "vehicle_reviews" ADD CONSTRAINT "vehicle_reviews_dates_check" CHECK ("ends_on" >= "starts_on");
ALTER TABLE "vehicle_reviews" ADD CONSTRAINT "vehicle_reviews_void_check" CHECK (("voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL) OR ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL));

-- Seed default review types if an existing user is present
INSERT INTO "vehicle_review_types" ("id", "name", "active", "created_by", "created_at")
SELECT gen_random_uuid(), t.name, true, u.id, CURRENT_TIMESTAMP
FROM (VALUES ('SOAT'), ('Revisión técnica'), ('Extintor')) AS t(name)
CROSS JOIN (SELECT id FROM "users" ORDER BY "created_at" ASC LIMIT 1) AS u
ON CONFLICT ("name") DO NOTHING;

