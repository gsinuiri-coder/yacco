---
name: sync-protocol
description: The offline sync protocol between the driver app (apps/mobile)
  and the API (apps/api/src/modules/sync) — invariants since 2026-10-22. Use
  whenever touching POST /api/v1/sync/operations, a sync operation type or
  version, the app's local queue, or the «Operaciones en revisión» inbox —
  envelope shape, ordering, idempotency, batching, quarantine.
---

# Sync protocol (mobile offline queue <-> API)

> **Estado real (2026-10-22):** Giancarlo reabrió la app del chofer (Fase 3,
> fila 11) y este diseño rige como invariante (`AGENTS.md`). El servidor está
> en `apps/api/src/modules/sync`: `POST /api/v1/sync/operations` (un SAVEPOINT
> por operación dentro de la transacción del lote), la bandeja
> `GET /sync/operations/in-review` y `PATCH /sync/operations/:id/resolution`
> (ADMIN). La app vive en `apps/mobile`; `packages/sync-engine` no existe.
> Lo que todavía no está: la alerta por correo de D-08 (necesita un proveedor;
> hoy la alerta es la bandeja «Operaciones en revisión» y un log).
>
> Decisión de implementación de la cuarentena: un rechazo por validación
> (400) se reintenta una vez; un choque con el estado del servidor (409, 403,
> 404 — la oficina ya marcó o corrigió la parada, la ruta terminó, es de otro
> chofer) va a cuarentena en el primer intento, porque reintentar no lo
> cambia: gana el servidor.

## Operation envelope

Every queued operation is generic and versioned:

```
{ id: uuid (device-generated), type: string, version: number,
  clientTimestamp: datetime, payload: object }
```

`id` is generated on the device (never server-assigned) — this is also true
for entities created in the field (e.g. a van-sale customer), which removes
identifier collisions entirely (spec §3.3).

## Ordering and idempotency

- Operations are applied **in the order the client generated them**
  (`clientTimestamp`), not the order they happen to arrive over a flaky
  connection.
- The server records every operation `id` it has applied. If the same `id`
  arrives again (retry after a dropped response, etc.), it is recognized as
  `DUPLICATE` and **never re-applied** — this is HU-16's core guarantee.
- `SyncOperation.status` is one of `APPLIED`, `DUPLICATE`, `REJECTED`.

## Batching (D-07)

A sync request carries a batch of operations for one route stop or session.
The whole batch is **one transaction**: a stop's delivery + sale + payment
either all land together or none do. Never partially apply a batch silently.

## Quarantine (D-08)

If a single operation in a batch fails validation twice (e.g. malformed
payload after a retry), it is quarantined: marked `REJECTED`, an email alert
fires, and **the rest of the batch still proceeds**. One bad operation must
never freeze the whole day's sync for a driver.

## Envelope versioning (D-06)

Envelopes carry `type` + `version`. The server must keep accepting older
versions from apps that haven't updated yet and normalize them internally.
Never change the shape of an existing `(type, version)` pair in place — ship
a new `version` instead.

## What this protects

This is the module most exposed to weeks of loose ends: intermittent
connectivity, retries, out-of-order delivery, app versions in the field
lagging the API. Treat "operation applied exactly once, in order, even sent
twice" (HU-16 E1) as the flagship integration test of the whole project.
