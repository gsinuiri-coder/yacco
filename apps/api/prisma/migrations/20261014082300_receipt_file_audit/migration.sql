-- Add nullable audit metadata without rewriting existing receipt file rows.
ALTER TABLE "receipt_files"
ADD COLUMN "created_at" TIMESTAMPTZ(6),
ADD COLUMN "created_by" UUID;

ALTER TABLE "receipt_files"
ADD CONSTRAINT "receipt_files_created_by_fkey"
FOREIGN KEY ("created_by") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
