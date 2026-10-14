-- CreateTable
CREATE TABLE "issuer_settings_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tax_id" VARCHAR(11) NOT NULL,
    "legal_name" TEXT NOT NULL,
    "fiscal_address" TEXT NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "prices_include_tax" BOOLEAN NOT NULL,
    "receipt_document_threshold" DECIMAL(10,2) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issuer_settings_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "receipt_type" NOT NULL,
    "medium" "receipt_medium" NOT NULL,
    "series" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issued_on" DATE NOT NULL,
    "customer_id" UUID NOT NULL,
    "issuer_settings_version_id" UUID NOT NULL,
    "taxable_amount" DECIMAL(10,2) NOT NULL,
    "tax_amount" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "affected_receipt_id" UUID,
    "reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by" UUID,
    "void_reason" TEXT,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_sales" (
    "receipt_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "released_at" TIMESTAMPTZ(6),
    "released_by" UUID,

    CONSTRAINT "receipt_sales_pkey" PRIMARY KEY ("receipt_id", "sale_id")
);

-- CreateTable
CREATE TABLE "receipt_files" (
    "receipt_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,

    CONSTRAINT "receipt_files_pkey" PRIMARY KEY ("receipt_id", "object_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_type_series_number_key" ON "receipts"("type", "series", "number");

-- A sale can belong to only one receipt that has not released it. PostgreSQL
-- partials over the authorized release marker keep this invariant atomic.
CREATE UNIQUE INDEX "receipt_sales_active_sale_key" ON "receipt_sales"("sale_id") WHERE "released_at" IS NULL;

-- AddForeignKey
ALTER TABLE "issuer_settings_versions" ADD CONSTRAINT "issuer_settings_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_issuer_settings_version_id_fkey" FOREIGN KEY ("issuer_settings_version_id") REFERENCES "issuer_settings_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_affected_receipt_id_fkey" FOREIGN KEY ("affected_receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts" ADD CONSTRAINT "receipts_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipt_sales" ADD CONSTRAINT "receipt_sales_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipt_sales" ADD CONSTRAINT "receipt_sales_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipt_sales" ADD CONSTRAINT "receipt_sales_released_by_fkey" FOREIGN KEY ("released_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written CHECK constraints: Prisma cannot express all-or-none groups.
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_void_check"
    CHECK (("voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL) OR ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL));

ALTER TABLE "receipt_sales" ADD CONSTRAINT "receipt_sales_release_check"
    CHECK (("released_at" IS NULL AND "released_by" IS NULL) OR ("released_at" IS NOT NULL AND "released_by" IS NOT NULL));
