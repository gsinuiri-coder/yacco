-- Expand: immutable audit history for list-price changes. Existing products
-- deliberately get no invented backfill; their next real edit records its
-- actual prior price.
CREATE TABLE "product_price_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "previous_price" NUMERIC(10,2),
    "new_price" NUMERIC(10,2) NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID NOT NULL,

    CONSTRAINT "product_price_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_price_changes_product_id_changed_at_idx"
ON "product_price_changes"("product_id", "changed_at" DESC);

ALTER TABLE "product_price_changes"
ADD CONSTRAINT "product_price_changes_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_price_changes"
ADD CONSTRAINT "product_price_changes_changed_by_fkey"
FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
