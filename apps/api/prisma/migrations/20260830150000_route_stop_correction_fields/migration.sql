-- AlterTable
ALTER TABLE "route_stops" ADD COLUMN     "corrected_at" TIMESTAMPTZ(6),
ADD COLUMN     "corrected_by" UUID,
ADD COLUMN     "correction_reason" TEXT;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_corrected_by_fkey" FOREIGN KEY ("corrected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Las tres columnas de corrección van juntas o ninguna, mismo idioma que los
-- cuatro CHECK de `sales`/`payments` en
-- 20260830120000_sale_and_payment_void_fields: una parada con `corrected_at`
-- pero sin quién ni por qué es una corrección que no se puede auditar, y un
-- motivo sin fecha no corrige nada. Escritos a mano porque Prisma no sabe
-- expresar un CHECK en el schema.
--
-- No hay backfill: las tres nacen nulas, así que toda fila existente satisface
-- ambas igualdades desde el primer momento.
--
-- Guardan SOLO LA ÚLTIMA corrección: una segunda corrección de la misma parada
-- las pisa. Es deliberado, no una limitación. La historia completa ya está
-- escrita y es inmutable —una venta anulada por corrección, con su propio
-- `voided_at`/`voided_by`/`void_reason`, y los movimientos `*_VOID` del libro—,
-- así que una tabla `route_stop_corrections` sería un modelo y una pantalla
-- que nadie pidió para contar lo que esas dos fuentes ya cuentan.
--
-- Sin índice a propósito. Nadie busca "las paradas corregidas": estas tres
-- columnas se leen SIEMPRE junto con la parada que ya se ubicó por su ruta
-- (`route_stops(route_id, position)`, que sí existe), nunca como criterio de
-- búsqueda propio. Un índice acá costaría escrituras en cada marca de parada
-- sin ahorrar una sola lectura.
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_corrected_at_corrected_by_check" CHECK (("corrected_at" IS NULL) = ("corrected_by" IS NULL));
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_corrected_at_correction_reason_check" CHECK (("corrected_at" IS NULL) = ("correction_reason" IS NULL));
