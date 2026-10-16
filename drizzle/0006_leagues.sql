CREATE TABLE IF NOT EXISTS "race_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"race_key" text NOT NULL,
	"track" text NOT NULL,
	"car" text NOT NULL,
	"place" integer NOT NULL,
	"class_place" integer,
	"finish_status" integer DEFAULT 0 NOT NULL,
	"laps" integer,
	"best_lap_seconds" real,
	"field_size" integer,
	"classification" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "race_results_user_race_idx" ON "race_results" ("user_id","race_key");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leagues" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"registration_open" boolean DEFAULT true NOT NULL,
	"points_table" text DEFAULT '25,18,15,12,10,8,6,4,2,1' NOT NULL,
	"fastest_lap_bonus" integer DEFAULT 0 NOT NULL,
	"pole_bonus" integer DEFAULT 0 NOT NULL,
	"participation_points" integer DEFAULT 0 NOT NULL,
	"created_by" integer REFERENCES "users"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "league_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL REFERENCES "leagues"("id"),
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"car_number" text,
	"team" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "league_entries_league_user_idx" ON "league_entries" ("league_id","user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "league_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL REFERENCES "leagues"("id"),
	"round" integer NOT NULL,
	"name" text NOT NULL,
	"track" text NOT NULL,
	"event_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "league_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL REFERENCES "league_events"("id"),
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"position" integer,
	"status" text DEFAULT 'finished' NOT NULL,
	"fastest_lap" boolean DEFAULT false NOT NULL,
	"pole" boolean DEFAULT false NOT NULL,
	"adjustment" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"entered_by" integer REFERENCES "users"("id"),
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "league_results_event_user_idx" ON "league_results" ("event_id","user_id");
