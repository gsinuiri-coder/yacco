---
name: sync-protocol
description: The agreed DESIGN of the offline sync protocol between the driver
  app and the API — a protocol not built yet (no sync module, no
  packages/sync-engine, empty apps/mobile). Use when designing or building
  that module, or when deciding what POST /api/v1/sync/operations should look
  like — envelope shape, ordering, idempotency, batching, quarantine. Not a
  description of code that exists today.
---

# Sync protocol (mobile offline queue <-> API)

> **Estado real, decidido con el dueño de la planta:** este documento es el
> diseño acordado del protocolo, no una descripción del código. El módulo de
> sincronización **no existe**: `POST /api/v1/sync/operations` no tiene
> controller ni servicio —solo la tabla `sync_operations`, modelada por
> adelantado—, `apps/mobile` contiene únicamente un `.gitkeep` y
> `packages/sync-engine` no existe como directorio. Hoy **la oficina registra
> cada parada desde la web**, con `PATCH /api/v1/routes/:id/stops/:stopId`
> (spec §4.3).
>
> Todo lo que sigue está en presente porque describe cómo debe comportarse el
> protocolo **cuando se construya**, y sigue siendo la decisión vigente sobre
> su forma. Construir la app del repartidor sigue siendo una decisión abierta,
> que se toma con el dueño de la planta; este diseño no la prejuzga.

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
