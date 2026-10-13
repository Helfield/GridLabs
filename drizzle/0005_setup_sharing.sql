CREATE TABLE IF NOT EXISTS "setups" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL REFERENCES "users"("id"),
	"session_id" integer REFERENCES "sessions"("id"),
	"reference_lap_id" integer REFERENCES "reference_laps"("id"),
	"track" text NOT NULL,
	"car" text NOT NULL,
	"name" text NOT NULL,
	"car_model" text,
	"track_folder" text,
	"svm" text,
	"live" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "setups" ADD COLUMN IF NOT EXISTS "live" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "setups_session_id_idx" ON "setups" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "setups_reference_lap_id_idx" ON "setups" ("reference_lap_id");
