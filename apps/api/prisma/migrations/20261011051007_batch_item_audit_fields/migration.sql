-- AlterTable
ALTER TABLE "batch_items" ADD COLUMN     "created_at" TIMESTAMPTZ(6),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "recorded_by" UUID;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
