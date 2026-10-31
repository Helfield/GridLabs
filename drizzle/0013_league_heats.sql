-- Splitting one round into several heats when the field is too big for a
-- single grid. A heat belongs to a round, and the drivers in it are recorded
-- per round as well (event_id) so "who is in which heat this weekend" is one
-- indexed lookup rather than a join through heats.
--
-- league_heat_entries has one row per driver per ROUND, not per heat: a driver
-- cannot sit in two heats of the same round. manual marks a row the operator
-- moved by hand, so a rebuild of the field can leave those alone.
--
-- league_results.heat_id records which heat a result came from. It is for
-- display and cross-checking only -- points are equal across heats, so
-- nothing in the scoring path reads it. It is SET NULL when a heat is deleted
-- (collapsing back to one grid) so results already entered survive it; the
-- entries under a heat go with it.
--
-- Additive: two new tables plus columns, so nothing already stored changes.
-- The same statements run at boot from db/ensure-schema.ts, so this file is
-- for a database built from scratch; whichever runs second is a no-op.
CREATE TABLE IF NOT EXISTS "league_heats" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL REFERENCES "league_events"("id") ON DELETE CASCADE,
	"number" integer NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "league_heats_event_number_idx" ON "league_heats" ("event_id","number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "league_heat_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL REFERENCES "league_events"("id") ON DELETE CASCADE,
	"heat_id" integer NOT NULL REFERENCES "league_heats"("id") ON DELETE CASCADE,
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "league_heat_entries_event_user_idx" ON "league_heat_entries" ("event_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "league_heat_entries_heat_id_idx" ON "league_heat_entries" ("heat_id");
--> statement-breakpoint
ALTER TABLE "league_results" ADD COLUMN IF NOT EXISTS "heat_id" integer REFERENCES "league_heats"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- Sizes the field is split to. The allocator uses these directly (see
-- buildHeats() in leagueRules.ts): the max sets how many heats a field needs,
-- and the min is what it collapses back to when a split would leave a heat too
-- small to race.
ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "max_cars_per_heat" integer DEFAULT 26 NOT NULL;
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "min_cars_per_heat" integer DEFAULT 8 NOT NULL;
