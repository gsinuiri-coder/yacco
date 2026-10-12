-- AlterTable
ALTER TABLE "accessory_movements" DROP CONSTRAINT "accessory_movements_quantity_check";
ALTER TABLE "accessory_movements" ADD CONSTRAINT "accessory_movements_quantity_check"
    CHECK ("quantity" <> 0 AND (type = 'COUNT_ADJUSTMENT' OR "quantity" > 0));
