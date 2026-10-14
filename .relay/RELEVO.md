# Relevo

status: blocked
item: Fase 3 — 8. Comprobantes registrados (goal en .relay/goals/fase3-8-comprobantes-y-guias.md)
branch: feat/receipts
last-step: Paso 5b detenido tras la revisión independiente: además de hallazgos corregibles de concurrencia, validación y UX, se comprobó que `receipt_files` permite adjuntos posteriores sin registrar `created_at` ni `created_by`, en conflicto con el requisito de que todo sea auditable y el invariante de filas operativas.
next-step: Giancarlo debe decidir si autoriza agregar `created_at` y `created_by` a `receipt_files` y cómo desplegar la corrección sin editar una migración ya aplicada; al reanudar, corregir con TDD los demás hallazgos finales y repetir los gates.
blocked-reason: Corregir la auditoría de `receipt_files` exige columnas no incluidas en el esquema cerrado del goal, que dice «Ninguna otra columna, tabla ni índice sin preguntar». El modo desatendido prohíbe inventar esa decisión o ejecutar una migración fuera de lo autorizado.
updated: 2026-10-14T04:44:37-05:00 por Codex
