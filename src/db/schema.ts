import { pgTable, serial, text, integer, timestamp, boolean, jsonb, real } from "drizzle-orm/pg-core";

// A user is either a coach or a student. Every account is required to be
// linked to a Discord account that's a verified member of the server --
// this is the "lead magnet" gate: you can't sign up unless you're already
// in the Discord.
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("student"), // "coach" | "student"
  discordId: text("discord_id").notNull().unique(),
  discordUsername: text("discord_username").notNull(),
  discordAvatarUrl: text("discord_avatar_url"),
  // Used by the local telemetry bridge app to authenticate uploads --
  // it isn't a browser, so it can't use the session cookie. Generated
  // on demand from the dashboard, sent as "Authorization: Bearer <token>".
  apiToken: text("api_token").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

// A reference lap -- either a student's own best lap, or one shared by a
// coach/another student. Matches the JSON format the local telemetry app
// already produces (lmu_coach's ReferenceLap.save()).
export const referenceLaps = pgTable("reference_laps", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => users.id),
  track: text("track").notNull(),
  // `car` MUST match the string the sim reports verbatim -- the local app
  // matches on it exactly when deciding which laps apply to the car you're
  // driving. That string is often unreadable (e.g. "GTE · United
  // Autosports 2025 #23:ELMS"), so it's not what we show people.
  car: text("car").notNull(),
  // `carDisplay` is purely cosmetic: a human-readable car name a coach
  // types in ("McLaren 720S GT3") so students know what the lap is for.
  // Nothing matches on it, and it's optional -- laps uploaded by the
  // local app won't have one, which is fine; the UI falls back to `car`.
  carDisplay: text("car_display"),
  label: text("label").notNull(), // e.g. "My PB" or "Coach's reference"
  // The full per-bin sample data, same shape as the local app's JSON export.
  // Stored as-is rather than normalized into rows -- it's read as a whole
  // unit (loaded into a ReferenceLap object), never queried bin-by-bin.
  data: jsonb("data").notNull(),
  lapTimeSeconds: real("lap_time_seconds"),
  isPublic: boolean("is_public").notNull().default(false), // sharable with other students
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A completed driving session -- one row per lap driven while the local
// bridge app was connected and streaming to a logged-in account.
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  track: text("track").notNull(),
  car: text("car").notNull(),
  referenceLapId: integer("reference_lap_id").references(() => referenceLaps.id), // what they compared against, if any
  lapTimeSeconds: real("lap_time_seconds"),
  sector1Seconds: real("sector_1_seconds"),
  sector2Seconds: real("sector_2_seconds"),
  sector3Seconds: real("sector_3_seconds"),
  // The lap's full per-bin telemetry, same shape as a reference lap's.
  // Nullable: laps logged before this existed have none, and the detail
  // page has to cope with that rather than assume every lap is
  // analysable.
  data: jsonb("data"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});