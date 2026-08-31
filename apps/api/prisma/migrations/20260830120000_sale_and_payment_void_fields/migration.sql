-- AlterEnum
-- Los tres tipos de anulación. Esta migración SOLO agrega los valores y las
-- columnas: ninguna sentencia de acá los usa, y no puede usarlos, porque
-- Postgres rechaza un valor de enum recién agregado dentro de la misma
-- transacción que lo agregó. Quien los emita será el PR de la operación de
-- corrección, en su propia transacción, mucho después de este commit.
ALTER TYPE "container_movement_type" ADD VALUE 'LOAN_DELIVERY_VOID';
ALTER TYPE "container_movement_type" ADD VALUE 'EMPTY_PICKUP_VOID';
ALTER TYPE "container_movement_type" ADD VALUE 'FULL_SALE_VOID';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "void_reason" TEXT,
ADD COLUMN     "voided_at" TIMESTAMPTZ(6),
ADD COLUMN     "voided_by" UUID;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "void_reason" TEXT,
ADD COLUMN     "voided_at" TIMESTAMPTZ(6),
ADD COLUMN     "voided_by" UUID;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Las tres columnas de anulación van juntas o ninguna: una fila con
-- `voided_at` pero sin quién ni por qué es una anulación que no se puede
-- auditar, y una razón sin fecha no anula nada. Escritos a mano porque
-- Prisma no sabe expresar un CHECK en el schema — mismo caso que
-- `payments_status_rejected_at_check` y `container_counts_counted_quantity_check`.
--
-- No hay backfill: las columnas nacen nulas en las tres, así que toda fila
-- existente satisface ambas igualdades desde el primer momento.
--
-- Sin índices a propósito. Nadie busca "las ventas anuladas": `voided_at`
-- nunca es el criterio de una consulta, solo un filtro secundario de
-- consultas que ya se acotan por otra cosa —la liquidación por su ruta, el
-- estado de cuenta por su cliente—, y encima sobre una columna que va a estar
-- nula en casi todas las filas. Un índice ahí costaría escrituras sin ahorrar
-- ninguna lectura. Si algún día una de esas dos consultas se vuelve lenta, lo
-- que le falta es un índice sobre SU criterio, no sobre este.
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_at_voided_by_check" CHECK (("voided_at" IS NULL) = ("voided_by" IS NULL));
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_at_void_reason_check" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL));
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_at_voided_by_check" CHECK (("voided_at" IS NULL) = ("voided_by" IS NULL));
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_at_void_reason_check" CHECK (("voided_at" IS NULL) = ("void_reason" IS NULL));
