-- Type, series and number are unique only among active receipts (Giancarlo,
-- 2026-10-14 19:43): a voided receipt stays visible, and the same paper can be
-- registered again with the right sales or date. Authorized exception to "no
-- DROP" in this row: the full unique index is replaced by the partial one in
-- the same migration, so there is never a window without uniqueness.
DROP INDEX "receipts_type_series_number_key";

CREATE UNIQUE INDEX "receipts_active_type_series_number_key" ON "receipts"("type", "series", "number") WHERE "voided_at" IS NULL;
