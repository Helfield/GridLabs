import { pgTable, serial, text, integer, timestamp, boolean, jsonb, real, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("student"),
  discordId: text("discord_id").notNull().unique(),
  discordUsername: text("discord_username").notNull(),
  discordAvatarUrl: text("discord_avatar_url"),
  apiToken: text("api_token").unique(),
  // Set when a member connects their Google account (see src/googleCalendar.ts
  // and the /league/calendar routes). The refresh token lets the site write
  // league races straight into their calendar without them being present;
  // the email is stored only so the account page can show what's connected.
  googleEmail: text("google_email"),
  googleRefreshToken: text("google_refresh_token"),
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
  // coach typing one in through the "Global reference laps" page? Used
  // for display and traceability on the coach's reference-laps page --
  // promotion itself no longer distinguishes the two (see db/promotions.ts).
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
  // A coach can disqualify a lap (track limits the automatic check
  // missed, a bugged time, anything). An excluded lap stays on the
  // driver's own history, marked, but is left out of the leaderboards,
  // the roster's best-lap column, and reference-lap promotion -- and any
  // reference it had already become is taken down. Reversible: restoring
  // it puts it back in contention. See db/queries.ts setSessionExcluded.
  excluded: boolean("excluded").notNull().default(false),
  excludedReason: text("excluded_reason"),
  excludedAt: timestamp("excluded_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One row per track that has a leaderboard message in the Discord
// channel (see discord/leaderboard.ts). The message is edited in place
// as laps come in rather than re-posted, which needs its id remembered
// across restarts; content_hash lets a sync skip the Discord call when
// nothing on the board changed; leaders records who was fastest in each
// class at the last sync, so a change of leader can be announced.
export const discordLeaderboardPosts = pgTable("discord_leaderboard_posts", {
  track: text("track").primaryKey(),
  messageId: text("message_id").notNull(),
  contentHash: text("content_hash"),
  leaders: jsonb("leaders"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// The car setup that was loaded in the garage when a lap was driven, shared
// by the driver (opt-in in the app). Attached to the session it was driven
// in, or to the reference lap it was uploaded with; a reference lap that was
// promoted from a session finds its setup through source_session_id. `svm`
// is the exact setup file; `live` is the garage's own setting values
// (key -> { value, stringValue, minValue, maxValue }) that the app can write
// back into the game. See setups.ts for what is accepted.
export const setups = pgTable("setups", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => users.id),
  sessionId: integer("session_id").references(() => sessions.id),
  referenceLapId: integer("reference_lap_id").references(() => referenceLaps.id),
  track: text("track").notNull(),
  car: text("car").notNull(),
  name: text("name").notNull(),
  carModel: text("car_model"),
  trackFolder: text("track_folder"),
  svm: text("svm"),
  live: jsonb("live"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Where a race finished, as the sim scored it, sent by the desktop app when
// the driver takes the flag. Never used for points -- it exists so the
// organisers can cross-check a result they were told or typed in by hand.
// One row per driver per race (race_key is generated by the app and sent
// again, with the full classification, when the session ends).
export const raceResults = pgTable(
  "race_results",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id),
    raceKey: text("race_key").notNull(),
    track: text("track").notNull(),
    car: text("car").notNull(),
    place: integer("place").notNull(),
    classPlace: integer("class_place"),
    finishStatus: integer("finish_status").notNull().default(0), // 0 racing, 1 finished, 2 DNF, 3 DQ
    laps: integer("laps"),
    bestLapSeconds: real("best_lap_seconds"),
    fieldSize: integer("field_size"),
    classification: jsonb("classification"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({ perRace: uniqueIndex("race_results_user_race_idx").on(t.userId, t.raceKey) }),
);

export const leagues = pgTable("leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  registrationOpen: boolean("registration_open").notNull().default(true),
  // Points for 1st, 2nd, ... as a comma-separated list ("25,18,15,...").
  pointsTable: text("points_table").notNull().default("25,18,15,12,10,8,6,4,2,1"),
  fastestLapBonus: integer("fastest_lap_bonus").notNull().default(0),
  poleBonus: integer("pole_bonus").notNull().default(0),
  // For a classified finisher outside the table, and for a DNF.
  participationPoints: integer("participation_points").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const leagueEntries = pgTable(
  "league_entries",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id").notNull().references(() => leagues.id),
    userId: integer("user_id").notNull().references(() => users.id),
    team: text("team"),
    // The driver's LMU licence bands as they chose them at registration, e.g. "Silver 2".
    // Optional -- left null if not supplied. (The earlier numeric sr_rating/dr_rating
    // columns are no longer read; see drizzle/0009.)
    srBand: text("sr_band"),
    drBand: text("dr_band"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ perDriver: uniqueIndex("league_entries_league_user_idx").on(t.leagueId, t.userId) }),
);

export const leagueEvents = pgTable("league_events", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leagues.id),
  round: integer("round").notNull(),
  name: text("name").notNull(),
  track: text("track").notNull(),
  eventDate: timestamp("event_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const leagueResults = pgTable(
  "league_results",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull().references(() => leagueEvents.id),
    userId: integer("user_id").notNull().references(() => users.id),
    position: integer("position"),
    status: text("status").notNull().default("finished"), // finished | dnf | dns | dsq
    fastestLap: boolean("fastest_lap").notNull().default(false),
    pole: boolean("pole").notNull().default(false),
    // Added or taken off after the table, e.g. a post-race penalty (-3).
    adjustment: integer("adjustment").notNull().default(0),
    points: integer("points").notNull().default(0),
    enteredBy: integer("entered_by").references(() => users.id),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({ perDriver: uniqueIndex("league_results_event_user_idx").on(t.eventId, t.userId) }),
);

// The Google Calendar event the site created in each connected driver's
// calendar for each league race, so a later edit can update that same event
// and a deletion can remove it, rather than leaving duplicates behind.
// Only drivers who connected Google AND are registered for the league get a
// row. See src/googleCalendar.ts and the sync helpers in db/league.ts.
export const leagueCalendarEvents = pgTable(
  "league_calendar_events",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id),
    eventId: integer("event_id").notNull().references(() => leagueEvents.id),
    googleEventId: text("google_event_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ perDriverEvent: uniqueIndex("league_calendar_events_user_event_idx").on(t.userId, t.eventId) }),
);
// Reaction roles: reacting to `messageId` with `emoji` gives a member `roleId`
// (removing the reaction takes it away). `emoji` is the unicode character, or
// "name:id" for a custom server emoji. Managed from /coach/discord and acted on
// by the bot in discord/gateway.ts.
export const reactionRoles = pgTable(
  "reaction_roles",
  {
    id: serial("id").primaryKey(),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id").notNull(),
    emoji: text("emoji").notNull(),
    roleId: text("role_id").notNull(),
    roleName: text("role_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ messageEmoji: uniqueIndex("reaction_roles_message_emoji_idx").on(t.messageId, t.emoji) }),
);

// The intro text of a message the bot itself posted (see createPanel), so the
// message can be rewritten when its reaction roles are edited.
export const reactionPanels = pgTable("reaction_panels", {
  messageId: text("message_id").primaryKey(),
  channelId: text("channel_id").notNull(),
  text: text("text").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Small key/value settings the bot reads at runtime and /coach/discord edits
// (currently: voice_lobby, the channel members join to get their own voice channel).
export const botSettings = pgTable("bot_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Voice channels the bot created for members, so it can delete them once empty
// (and still find them after a restart).
export const tempVoiceChannels = pgTable("temp_voice_channels", {
  channelId: text("channel_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
