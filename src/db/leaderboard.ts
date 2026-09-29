import { db } from "./client";
import { users, sessions } from "./schema";
import { eq, and, isNotNull, inArray, asc } from "drizzle-orm";
import { carClass, classRank } from "./queries";
import { isValidLap } from "./promotions";

/**
 * Fastest laps per track, split by car class -- what the Discord
 * leaderboard channel shows (discord/leaderboard.ts).
 *
 * Built from SESSIONS, i.e. every lap the desktop app has uploaded, not
 * from published reference laps: the coach dashboard already ranks
 * drivers by their session times, so this is the same "fastest driver"
 * the site shows, just per track and per class. One entry per driver
 * (their own best), so one quick driver can't fill the whole board.
 *
 * Classes are kept strictly apart -- a GT3 time is never ranked against
 * an LMP2 time -- using the same carClass() the rest of the site uses
 * to decide which reference laps apply to which cars. A car whose
 * class can't be told gets its own "Unclassified" board rather than
 * being guessed into someone else's.
 */

export const LEADERBOARD_SIZE = 5;
export { classRank, classDisplayName } from "./queries";

export type LeaderboardRow = {
  userId: number;
  name: string;
  car: string;
  lapTimeSeconds: number;
  sessionId: number;
  setAt: Date;
};

export type ClassBoard = { carClass: string; rows: LeaderboardRow[] };
export type TrackBoard = { track: string; classes: ClassBoard[] };

/** Every track that has at least one timed session, alphabetically. */
export async function listTracksWithLaps(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ track: sessions.track })
    .from(sessions)
    .where(and(isNotNull(sessions.lapTimeSeconds), eq(sessions.excluded, false)));
  // "Unknown Track" is what the app sends when the sim hasn't named the
  // circuit yet -- not a place anyone can set a time.
  return rows
    .map((r) => r.track)
    .filter((t) => t && t !== "Unknown Track")
    .sort((a, b) => a.localeCompare(b));
}

export async function getTrackBoard(track: string, limit = LEADERBOARD_SIZE): Promise<TrackBoard> {
  // Summary columns only -- `data` is the whole lap's telemetry and can
  // run to hundreds of KB per row, so it's fetched one row at a time
  // below, and only for laps that are actually in contention.
  const candidates = await db.query.sessions.findMany({
    // Disqualified laps never make the board.
    where: and(eq(sessions.track, track), isNotNull(sessions.lapTimeSeconds), eq(sessions.excluded, false)),
    columns: { id: true, userId: true, car: true, lapTimeSeconds: true, createdAt: true },
    orderBy: [asc(sessions.lapTimeSeconds)],
  });

  // Walk each class fastest-first, placing a driver's first VALID lap
  // and skipping the rest of theirs. Validity (a plausible duration and
  // no standstill in the telemetry -- promotions.isValidLap) needs the
  // telemetry, which is why it's checked lazily here: a driver's
  // quickest "lap" is often an out-lap or a spin, and their real best
  // is the next one down.
  const byClass = new Map<string, LeaderboardRow[]>();
  const placed = new Map<string, Set<number>>(); // class -> userIds already on it
  for (const s of candidates) {
    // No class means no fair board to put it on -- old app builds sent
    // car names with no class prefix, and a few sent a garbled one.
    const cls = carClass(s.car);
    if (!cls) continue;
    const rows = byClass.get(cls) ?? [];
    if (rows.length >= limit) continue;
    const seen = placed.get(cls) ?? new Set<number>();
    if (seen.has(s.userId)) continue;

    const withData = await db.query.sessions.findFirst({
      where: eq(sessions.id, s.id),
      columns: { data: true },
    });
    if (!isValidLap(s.lapTimeSeconds, withData?.data)) continue;

    rows.push({
      userId: s.userId,
      name: "",
      car: s.car,
      lapTimeSeconds: s.lapTimeSeconds as number,
      sessionId: s.id,
      setAt: s.createdAt,
    });
    seen.add(s.userId);
    byClass.set(cls, rows);
    placed.set(cls, seen);
  }

  const userIds = [...new Set([...byClass.values()].flat().map((r) => r.userId))];
  const owners = userIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, userIds), columns: { id: true, name: true } })
    : [];
  const nameById = new Map(owners.map((u) => [u.id, u.name]));
  for (const rows of byClass.values()) {
    for (const row of rows) row.name = nameById.get(row.userId) ?? "Unknown driver";
  }

  const classes = [...byClass.entries()]
    .map(([cls, rows]) => ({ carClass: cls, rows }))
    .sort((a, b) => classRank(a.carClass) - classRank(b.carClass) || a.carClass.localeCompare(b.carClass));

  return { track, classes };
}

export function formatLapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return minutes > 0 ? `${minutes}:${rest.toFixed(3).padStart(6, "0")}` : rest.toFixed(3);
}
