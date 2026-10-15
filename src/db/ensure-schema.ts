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
