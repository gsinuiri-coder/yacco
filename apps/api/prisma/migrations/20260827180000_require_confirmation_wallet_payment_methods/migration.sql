-- Data-only migration (no column/type changes): corrects a desync between
-- the seed (apps/api/prisma/seed.ts, lines 86-91) and the production
-- database, not a business-rule change. The seed has always intended
-- Transferencia/Yape/Plin to require office confirmation before a
-- wallet payment counts as settled; Neon was seeded once, before that was
-- true, and Render's build runs `db:deploy` but never `db:seed`, so the
-- stale value was never corrected on its own.
--
-- SalesService.registerStopDeliveryWithinTransaction reads this column to
-- decide whether a payment is born CONFIRMED or PENDING. With it at false,
-- a Yape/Plin/Transferencia collection was settling itself on the spot,
-- with nobody having checked the money actually arrived, and the payments
-- confirmation tray (#66) had nothing to ever show for those methods.
--
-- This is a migration, not a manual UPDATE against Neon, because CLAUDE.md
-- forbids touching the database directly and because the migration history
-- has to record when and why this column changed. Idempotent: safe to run
-- against a database already holding the correct values. There were zero
-- payments in production at the time this was found, so there is no
-- historical Payment row whose status this changes.
--
-- Efectivo is untouched: cash the driver counts in hand is firm on the
-- spot, and its `false` was always correct.
UPDATE "payment_methods"
SET "requires_confirmation" = true
WHERE "name" IN ('Transferencia', 'Yape', 'Plin');
