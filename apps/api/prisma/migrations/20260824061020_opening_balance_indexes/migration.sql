-- Hand-written (spec §3.5 "Decisiones de diseño de datos" pattern, same as
-- customer_locations_one_primary_per_customer / customer_prices_base_price_key):
-- Prisma cannot express a partial index in the schema.
--
-- One opening credit per customer: payments carries customer_id directly, so
-- this index expresses the whole rule by itself.
CREATE UNIQUE INDEX "payments_opening_balance_customer_key" ON "payments"("customer_id") WHERE "is_opening_balance";

-- One opening charge per customer is the intended rule too, but sales hangs
-- off the location and has no customer_id column — it cannot know which
-- customer a location belongs to without a join. This index can only catch
-- a duplicate opening charge on the SAME location; the real "one per
-- customer, across every one of their locations" rule is enforced in
-- SalesService (it checks every location the customer has before creating
-- one), the same division of labor customer_prices already uses between its
-- DB-level uniqueness and its service-level precedence rule.
CREATE UNIQUE INDEX "sales_opening_balance_location_key" ON "sales"("location_id") WHERE "is_opening_balance";
