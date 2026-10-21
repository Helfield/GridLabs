-- Two league divisions split on the LMU licence bands, and a mixed-class race
-- scored by class. Additive: existing leagues get a null band window (anyone
-- may register) and existing results get no class, so they score exactly as
-- before. The same statements run at boot from db/ensure-schema.ts, so this
-- file is for a database built from scratch; whichever runs second is a no-op.
ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "band_min" text;
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "band_max" text;
--> statement-breakpoint
ALTER TABLE "league_results" ADD COLUMN IF NOT EXISTS "car_class" text;
--> statement-breakpoint
ALTER TABLE "league_results" ADD COLUMN IF NOT EXISTS "class_position" integer;
