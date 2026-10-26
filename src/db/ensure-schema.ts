import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * Bring the database up to the columns the code expects, on every start.
 *
 * Migrations here are run by hand (`bun run db:migrate`), and a deploy
 * that ships code needing a new column before anyone has run one would
 * fail EVERY query touching that table -- drizzle selects all of a
 * table's columns. So the additive changes are also applied here,
 * idempotently (IF NOT EXISTS), exactly as drizzle/0004 does; whichever
 * of the two runs second is a no-op. Additive only -- nothing here may
 * drop or rewrite data.
 */
export async function ensureSchema(): Promise<void> {
  await db.execute(sql`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "excluded" boolean DEFAULT false NOT NULL`);
  await db.execute(sql`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "excluded_reason" text`);
  await db.execute(sql`ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "excluded_at" timestamp`);
  // Shared car setups (drizzle/0005_setup_sharing.sql): a new table, so nothing existing is touched.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "setups" (
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
  )`);
  await db.execute(sql`ALTER TABLE "setups" ADD COLUMN IF NOT EXISTS "live" jsonb`);
  await db.execute(sql`ALTER TABLE "setups" ADD COLUMN IF NOT EXISTS "car_model" text`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "setups_session_id_idx" ON "setups" ("session_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "setups_reference_lap_id_idx" ON "setups" ("reference_lap_id")`);
  // League tables (drizzle/0006_leagues.sql): all new, so nothing existing is touched.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "race_results" (
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
)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "race_results_user_race_idx" ON "race_results" ("user_id","race_key")`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "leagues" (
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
)`);
  // Who may register, as the two ends of LICENCE_BANDS. Both null leaves the
  // league open to everyone, which is what every league here is today.
  await db.execute(sql`ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "band_min" text`);
  await db.execute(sql`ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "band_max" text`);
  await db.execute(sql`ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "dropped_rounds" integer DEFAULT 0 NOT NULL`);
  // When marking attendance for a round stops being editable by the driver.
  await db.execute(sql`ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "rsvp_closes_hours_before" integer DEFAULT 24 NOT NULL`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "league_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL REFERENCES "leagues"("id"),
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"car_number" text,
	"team" text,
	"created_at" timestamp DEFAULT now() NOT NULL
)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "league_entries_league_user_idx" ON "league_entries" ("league_id","user_id")`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "league_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"league_id" integer NOT NULL REFERENCES "leagues"("id"),
	"round" integer NOT NULL,
	"name" text NOT NULL,
	"track" text NOT NULL,
	"event_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "league_results" (
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
)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "league_results_event_user_idx" ON "league_results" ("event_id","user_id")`);
  // A mixed-class race scores on the class result. Both null on a single-class
  // league, where "position" carries the points, so nothing already entered
  // changes when these land.
  await db.execute(sql`ALTER TABLE "league_results" ADD COLUMN IF NOT EXISTS "car_class" text`);
  await db.execute(sql`ALTER TABLE "league_results" ADD COLUMN IF NOT EXISTS "class_position" integer`);
  // League registration records LMU licence bands now instead of the numeric SR/DR
  // ratings that were only ever displayed (drizzle/0009). Additive: the old
  // sr_rating/dr_rating columns are simply no longer read, the way car_number was.
  await db.execute(sql`ALTER TABLE "league_entries" ADD COLUMN IF NOT EXISTS "sr_band" text`);
  await db.execute(sql`ALTER TABLE "league_entries" ADD COLUMN IF NOT EXISTS "dr_band" text`);
  // Attendance marking (drizzle/0012_league_availability.sql): a new table, so
  // nothing existing is touched. A driver with no row has not answered, which
  // the views count separately from a "not sure".
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "league_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL REFERENCES "league_events"("id"),
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"status" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "league_availability_event_user_idx" ON "league_availability" ("event_id","user_id")`);
  // Google Calendar connection on the account, and the per-driver record of
  // which calendar event was created for each league race (see src/googleCalendar.ts).
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_email" text`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_refresh_token" text`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "league_calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL REFERENCES "users"("id"),
	"event_id" integer NOT NULL REFERENCES "league_events"("id"),
	"google_event_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "league_calendar_events_user_event_idx" ON "league_calendar_events" ("user_id","event_id")`);
  // Discord reaction roles (see schema.ts reactionRoles): a new table, so nothing existing is touched.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "reaction_roles" (
    "id" serial PRIMARY KEY NOT NULL,
    "channel_id" text NOT NULL,
    "message_id" text NOT NULL,
    "emoji" text NOT NULL,
    "role_id" text NOT NULL,
    "role_name" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "reaction_roles_message_emoji_idx" ON "reaction_roles" ("message_id", "emoji")`);
  // Text of bot-posted reaction-role messages, so they can be edited in place.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "reaction_panels" (
    "message_id" text PRIMARY KEY NOT NULL,
    "channel_id" text NOT NULL,
    "text" text DEFAULT '' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`);
  // Bot runtime settings and the temporary voice channels it has made.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "bot_settings" (
    "key" text PRIMARY KEY NOT NULL,
    "value" text NOT NULL
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "temp_voice_channels" (
    "channel_id" text PRIMARY KEY NOT NULL,
    "owner_id" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`);
}
