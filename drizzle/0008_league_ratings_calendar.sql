ALTER TABLE "league_entries" ADD COLUMN IF NOT EXISTS "sr_rating" real;
--> statement-breakpoint
ALTER TABLE "league_entries" ADD COLUMN IF NOT EXISTS "dr_rating" real;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_email" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_refresh_token" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "league_calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"event_id" integer NOT NULL REFERENCES "league_events"("id"),
	"google_event_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "league_calendar_events_user_event_idx" ON "league_calendar_events" ("user_id","event_id");
