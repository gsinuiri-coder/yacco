-- Expand only: an index, no column. Supports the account statement
-- (CustomersService.getAccountStatement), which reads a customer's sales by
-- location ordered by sold_at. Backlog «Falta índice en sales (location_id,
-- sold_at)», item 4f of docs/plan-piloto.md.
--
-- Plain CREATE INDEX, not CONCURRENTLY: it holds a SHARE lock on sales
-- (reads go on, writes wait) only while it builds, which on ~100 rows is
-- milliseconds, and it keeps the file a plain transactional migration.
CREATE INDEX "sales_location_id_sold_at_idx" ON "sales"("location_id", "sold_at");
