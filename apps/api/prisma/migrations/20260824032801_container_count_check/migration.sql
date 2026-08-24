-- Hand-written (spec §3.5 "Decisiones de diseño de datos" pattern, same as
-- container_movements_quantity_check / customer_container_balances_quantity_check):
-- Prisma cannot express CHECK constraints in the schema.
--
-- Only countedQuantity is constrained to be non-negative — nobody counts
-- fewer than zero containers. expectedQuantity deliberately has NO such
-- constraint: it is a snapshot of a balance that can itself be negative (an
-- already-decided, valid domain state meaning unregistered fleet entries),
-- and the count row must be able to record that snapshot exactly as it was.
ALTER TABLE "container_counts" ADD CONSTRAINT "container_counts_counted_quantity_check" CHECK ("counted_quantity" >= 0);
