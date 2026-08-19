---
name: demo-seed
description: Seeding realistic demo data and running the demo script. Use
  before every sprint demo, before the pilot, and whenever loading the real
  customer roster into the demo or production database.
---

# Demo seed

## Realistic Peruvian data

Seed data must look like the real plant, not placeholder fixtures:

- Customer names, addresses and phone numbers in Peruvian format.
- Currency always `S/`, formatted `S/ 1,250.50`.
- Payment methods: `EFECTIVO`, `TRANSFERENCIA`, `YAPE`, `PLIN` — cover more
  than one in any seeded set of payments, since the payment-method report
  (HU-19 area) depends on the mix being real.
- Zones named after actual delivery areas once known (post the S0a-D7
  interview), placeholder zone names before that.
- Container types: `CON_CAÑO` / `SIN_CAÑO` (`WITH_SPIGOT` / `WITHOUT_SPIGOT`
  as identifiers per `yacco-conventions`).

## Demo script per sprint

Each sprint's demo is the owner _doing_ the task, not watching it:

- S1: register a real customer, assign their agreed custom price.
- S2: register the day's production batch.
- S3: pull the "containers on loan" report against what the owner believes
  is out there; log every discrepancy as validation data, not a bug.
- S4: capture tomorrow's real orders; trigger the credit-limit warning on a
  real customer.
- S5: plan tomorrow's real route, see the FIFO-calculated load.
- S6/S7: a real route with double bookkeeping (app + notebook).
- S8: watch synced field operations land on the panel; settle a route.

## Loading the real customer roster (spec §5.3.2)

When importing the plant's actual notebook-based customer list:

1. Create customers first (HU-05 shape), zero balances.
2. Seed opening container balances as dated `LOAN_DELIVERY` movements (D-12)
   — never write directly to `customer_container_balances`. The ledger stays
   the single source of truth from day one, so reconciliation doesn't fail
   just because the starting balances were an import, not a real delivery.
3. Seed opening money debt the same way: a dated `Sale`/charge, not a raw
   update to `customers.debt_balance`.
4. Cross-check totals against the owner's own count before treating the
   import as final — discrepancies here are exactly what S3's demo is meant
   to surface.
