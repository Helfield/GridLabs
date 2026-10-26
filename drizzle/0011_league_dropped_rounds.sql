-- A season scores its best results: the worst few rounds leave a driver's
-- total, so one bad night and one missed weekend don't decide a title.
-- Additive: existing leagues get 0, which is every round counting, exactly what
-- they do today. The same statement runs at boot from db/ensure-schema.ts, so
-- this file is for a database built from scratch; whichever runs second is a
-- no-op.
ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "dropped_rounds" integer DEFAULT 0 NOT NULL;
