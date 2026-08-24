-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "is_opening_balance" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "is_opening_balance" BOOLEAN NOT NULL DEFAULT false;
