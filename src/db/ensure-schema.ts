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
}
