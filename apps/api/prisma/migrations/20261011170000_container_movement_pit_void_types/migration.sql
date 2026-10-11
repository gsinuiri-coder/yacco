-- AlterEnum
-- Los tres tipos de anulación para paradas en planta (pit). Esta migración SOLO agrega los valores:
-- ninguna sentencia de acá los usa, y no puede usarlos, porque Postgres rechaza un valor de enum
-- recién agregado dentro de la misma transacción que lo agregó.
ALTER TYPE "container_movement_type" ADD VALUE 'ROUTE_LOAD_VOID';
ALTER TYPE "container_movement_type" ADD VALUE 'EMPTY_UNLOAD_VOID';
ALTER TYPE "container_movement_type" ADD VALUE 'FULL_RETURN_VOID';
