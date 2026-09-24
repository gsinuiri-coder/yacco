-- Expand: la cuenta técnica del smoke del deploy (ítem 3 de
-- docs/plan-endurecimiento.md). Aditiva: ninguna fila existente cambia, y
-- nada de este mismo archivo usa el valor nuevo, así que `ADD VALUE` puede
-- correr dentro de la transacción de la migración.
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'VIEWER';
