-- What the system BELIEVES a customer holds may be negative; what is
-- physically COUNTED never is. This drops the first, keeps the second.
--
-- customer_container_balances.quantity is a belief materialized from the
-- ledger, and the belief can be wrong: the previous driver forgot to write
-- down a delivery, the books say the customer has 2, the customer hands
-- back 3. With this CHECK in place the balance could not go to -1 and the
-- transaction died with a raw Postgres error on the driver's phone,
-- mid-route — the opposite of "warn, never block" for field operations.
-- The driver's way out was to not register the return, and then BOTH
-- facts were lost. A balance at -1 is information: it says there is a
-- delivery nobody recorded. The sign IS the signal, so it must be storable.
ALTER TABLE "customer_container_balances" DROP CONSTRAINT "customer_container_balances_quantity_check";

-- container_counts_counted_quantity_check (counted_quantity >= 0) stays on
-- purpose: nobody counts fewer than zero physical containers. A count of 0
-- against a belief of -1 is exactly how the missing delivery surfaces —
-- as a COUNT_ADJUSTMENT of +1 into WITH_CUSTOMER.
