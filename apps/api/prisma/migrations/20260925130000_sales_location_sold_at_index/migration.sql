-- Expand only: an index, no column. Supports the account statement
-- (CustomersService.getAccountStatement), which reads a customer's sales by
-- location ordered by sold_at. Backlog «Falta índice en sales (location_id,
-- sold_at)», item 4f of docs/plan-piloto.md.
--
-- Plain CREATE INDEX, not CONCURRENTLY: Prisma runs each migration in a
-- transaction, where CONCURRENTLY is not allowed. On ~100 rows the write lock
-- lasts milliseconds.
CREATE INDEX "sales_location_id_sold_at_idx" ON "sales"("location_id", "sold_at");
