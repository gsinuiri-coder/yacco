-- Fase 3, fila 11 (expand): cuarentena y revisión de las operaciones que
-- manda la app del chofer. Solo columnas nullable; nada se borra ni cambia de
-- tipo.
ALTER TABLE "sync_operations"
ADD COLUMN "envelope_version" INTEGER,
ADD COLUMN "received_at" TIMESTAMPTZ(6),
ADD COLUMN "attempts" INTEGER,
ADD COLUMN "rejection_reason" TEXT,
ADD COLUMN "quarantined_at" TIMESTAMPTZ(6),
ADD COLUMN "resolved_at" TIMESTAMPTZ(6),
ADD COLUMN "resolved_by" UUID,
ADD COLUMN "resolution_note" TEXT;

-- AddForeignKey
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: Prisma cannot express CHECK constraints. La resolución va
-- entera o no va, y solo existe sobre una operación en cuarentena.
ALTER TABLE "sync_operations"
ADD CONSTRAINT "sync_operations_resolution_all_or_none_check"
CHECK (
  ("resolved_at" IS NULL AND "resolved_by" IS NULL AND "resolution_note" IS NULL)
  OR ("resolved_at" IS NOT NULL AND "resolved_by" IS NOT NULL AND "resolution_note" IS NOT NULL
      AND "quarantined_at" IS NOT NULL)
),
ADD CONSTRAINT "sync_operations_attempts_positive_check"
CHECK ("attempts" IS NULL OR "attempts" >= 1);
