-- Drivers mark each round as coming, not coming or not sure, so the field can
-- be built from people who said yes rather than from the registration list.
-- No row means the driver has not answered, which is counted separately from a
-- "not sure" and leaves them out once marking closes.
-- Additive: a new table plus one column on leagues, so nothing already stored
-- changes. The same statements run at boot from db/ensure-schema.ts, so this
-- file is for a database built from scratch; whichever runs second is a no-op.
CREATE TABLE IF NOT EXISTS "league_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL REFERENCES "league_events"("id"),
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"status" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "league_availability_event_user_idx" ON "league_availability" ("event_id","user_id");
--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "rsvp_closes_hours_before" integer DEFAULT 24 NOT NULL;
