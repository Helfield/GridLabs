import { pgTable, serial, text, integer, timestamp, boolean, jsonb, real, type AnyPgColumn } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("student"),
  discordId: text("discord_id").notNull().unique(),
  discordUsername: text("discord_username").notNull(),
  discordAvatarUrl: text("discord_avatar_url"),
  apiToken: text("api_token").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

export const referenceLaps = pgTable("reference_laps", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => users.id),
  track: text("track").notNull(),
  car: text("car").notNull(),
  carDisplay: text("car_display"),
  label: text("label").notNull(),
  data: jsonb("data").notNull(),
  lapTimeSeconds: real("lap_time_seconds"),
  isPublic: boolean("is_public").notNull().default(false),
  // Was this row created automatically because a student's session beat
  // the previous public reference for its track/class, as opposed to a
  // coach typing one in through the "Global reference laps" page? This
  // is what decides whether the NEXT faster student lap can freely
  // replace it (true) or has to be flagged for the coach to approve
  // first (false) -- see db/promotions.ts.
  autoPromoted: boolean("auto_promoted").notNull().default(false),
  // Which session earned this promotion, if it was one -- null for a
  // coach-typed lap. Kept for traceability/display ("set by Connor from
  // this session"), not used in any matching logic.
  sourceSessionId: integer("source_session_id").references((): AnyPgColumn => sessions.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  track: text("track").notNull(),
  car: text("car").notNull(),
  referenceLapId: integer("reference_lap_id").references(() => referenceLaps.id),
  lapTimeSeconds: real("lap_time_seconds"),
  sector1Seconds: real("sector_1_seconds"),
  sector2Seconds: real("sector_2_seconds"),
  sector3Seconds: real("sector_3_seconds"),
  data: jsonb("data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A student session that beat the current PUBLIC reference for its
// track/class, where that reference was coach-set (autoPromoted: false
// on referenceLaps) -- so it's held here for the coach to approve or
// reject rather than silently replacing something they curated by hand.
// One row per pending decision; resolved rows are kept (not deleted) as
// a record of what was decided, not just what's currently outstanding.
export const promotionApprovals = pgTable("promotion_approvals", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessions.id),
  track: text("track").notNull(),
  carClass: text("car_class"), // may be null -- see carClass() in queries.ts
  lapTimeSeconds: real("lap_time_seconds").notNull(),
  // The reference this session would replace, and its time -- captured
  // at the moment the approval was raised, so what's shown to the coach
  // can't drift if something else changes before they act on it.
  currentReferenceLapId: integer("current_reference_lap_id")
    .notNull()
    .references(() => referenceLaps.id),
  currentReferenceLapTimeSeconds: real("current_reference_lap_time_seconds").notNull(),
  status: text("status").notNull().default("pending"), // "pending" | "approved" | "rejected"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});