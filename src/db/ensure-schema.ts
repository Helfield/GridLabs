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
}
