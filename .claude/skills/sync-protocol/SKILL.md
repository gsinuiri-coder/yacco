---
name: sync-protocol
description: The offline sync protocol between the driver app and the API.
  Use for anything touching packages/sync-engine, the mobile local queue, or
  POST /api/v1/sync/operations — envelope shape, ordering, idempotency,
  batching, quarantine.
---

# Sync protocol (mobile offline queue <-> API)

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
