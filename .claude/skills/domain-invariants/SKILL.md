---
name: domain-invariants
description: Domain invariants for the container fleet, production, routes and
  sales modules. Use whenever touching containers, production, routes or
  sales — schema, service logic, or tests — to make sure a change doesn't
  break the ledger, the materialized balances, or FIFO.
---

# Yacco domain invariants

## The two ledgers (source of truth)

- `container_movements`: every change to the fleet or to a customer's
  container balance. **Immutable — no UPDATE, no DELETE, ever.** Corrections
  are inverse movements (see D-17 in the execution plan).
- `sales` / `payments`: every change to a customer's money debt. Same rule:
  immutable, corrections are new rows, never edits.

Materialized balances (`customer_container_balances.quantity`,
`customers.debt_balance`) are caches for fast reads. They update in the
**same transaction** as the ledger row that causes them, and must always be
reconstructible by replaying the ledger from scratch. If a change touches a
balance without writing the corresponding ledger row in the same transaction,
it is wrong.

## `ContainerMovementType` effects

| Type               | Fleet effect                                       | Customer balance effect                   |
| ------------------ | -------------------------------------------------- | ----------------------------------------- |
| `FLEET_ENTRY`      | + empties in plant                                 | —                                         |
| `FILLING`          | − empties, + fulls (by batch) in plant             | —                                         |
| `ROUTE_LOAD`       | fulls: plant → en route (FIFO reserve at planning) | —                                         |
| `LOAN_DELIVERY`    | fulls: en route → with customer                    | **+N** (customer owes N containers)       |
| `EMPTY_PICKUP`     | empties: with customer → en route                  | **−N**                                    |
| `FULL_RETURN`      | fulls: en route → plant (unsold return)            | —                                         |
| `EMPTY_UNLOAD`     | empties: en route → plant                          | —                                         |
| `FULL_SALE`        | fulls leave the fleet (sold, plant or en route)    | none — sold units never touch the balance |
| `DAMAGE_WRITE_OFF` | any state in plant → write-off                     | none (plant-side damage)                  |
| `LOSS_WRITE_OFF`   | with customer → write-off                          | **−N** (loss declared, balance clears)    |

Plus `OPENING_BALANCE` and `COUNT_ADJUSTMENT` (cutover and physical count),
and the three anulaciones — `LOAN_DELIVERY_VOID`, `EMPTY_PICKUP_VOID`,
`FULL_SALE_VOID` — each the reverse of its own type. All five are
INTERNAL_ONLY: they never enter through `POST /container-movements`, because
each has a companion record it must stay in lock-step with.

A void records that something written down NEVER HAPPENED — nothing moves in
the plant, the books are what gets corrected. They are separate types, not
new pairs on the type they undo, because `RouteSettlementService` aggregates
by `type`: a reverse typed `LOAN_DELIVERY` would ADD to `fullDelivered`
instead of subtracting. Two consequences that follow from that, and that any
new code has to respect:

- **Anything that reads the ledger by `type` must net its void type**;
  anything that reads by `fromState`/`toState` needs no change at all and
  must not get one (`getRouteFullStock`, `inventory()`, the reconciliation
  report — the void movements correct those on their own).
- **Every aggregate that sums money as a BALANCE filters `voidedAt: null`**
  on `Sale`/`Payment`. A total that describes a LIST instead (the payment
  tray's `totals`, which shares its `where` with the page it sums) does not,
  and says so in a comment.
- A void must carry the same `routeId` as the movement it undoes, or the
  settlement will not net it.
- Voiding is never an edit: `voidedAt`/`voidedById`/`voidReason` are the only
  columns that change, all three together (DB CHECK), and the void's own
  ledger movement plus `customers.debt_balance` move in the SAME transaction.

Two independent debts per customer: container balance (units) and money debt
(S/). Never mix them — a container write-off is never converted to a monetary
charge implicitly, and vice versa.

`EMPTY_UNLOAD` has exactly one automatic producer: **settling the route**
(`RouteSettlementService.settle`), one movement per container type counted at
the plant door. It is emitted from that PHYSICAL COUNT, never from the ledger's
own `EMPTY_PICKUP` total — so if the driver hands back more than anyone
recorded, `EMPTY_ON_ROUTE` goes negative for that type. That sign is the
finding ("there are pickups nobody registered"), same reasoning as a negative
customer balance: never block it, never clamp it to zero. `fullReturned` is
NOT symmetric and emits nothing — see the backlog entry, it needs a batch
attribution rule first.

## Reconciliation routine

Any change to `ContainersService`/`SalesService` must keep this true:
`sum(container_movements grouped by type, direction) == parque total by state`
and `sum(customer_container_balances) == sum of LOAN_DELIVERY − EMPTY_PICKUP −
LOSS_WRITE_OFF per customer`. Write this as a test, not a manual check — it's
the first invariant test in S2 and it stays in CI and in the daily cron (6.4
of the execution plan).

## FIFO

Route loading always consumes the oldest `ProductionBatch` with `availableQty

> 0` first (`RoutesService.loadFifo`). Never let a caller choose the batch.

## Credit limit

Exceeding a customer's `creditLimit` on a sale WARNS and sets
`Sale.creditLimitExceeded = true`; it never blocks the sale.
