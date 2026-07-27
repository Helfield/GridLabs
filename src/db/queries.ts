import { db } from "./client";
import { users, sessions, referenceLaps } from "./schema";
import { eq, and, or, inArray, sql } from "drizzle-orm";

export async function getUserById(id: number) {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

export type StudentSummary = {
  id: number;
  name: string;
  email: string;
  discordUsername: string;
  discordAvatarUrl: string | null;
  sessionCount: number;
  bestLapTimeSeconds: number | null;
  lastSessionAt: Date | null;
};

// One query for the student list, one grouped query for their session
// stats, merged in JS -- avoids an N+1 query per student while staying
// simple to read.
export async function getAllStudents(): Promise<StudentSummary[]> {
  const students = await db.query.users.findMany({
    where: eq(users.role, "student"),
  });
  const stats = await db
    .select({
      userId: sessions.userId,
      sessionCount: sql<number>`count(*)`.as("session_count"),
      bestLapTimeSeconds: sql<number | null>`min(${sessions.lapTimeSeconds})`.as("best_lap"),
      lastSessionAt: sql<Date | null>`max(${sessions.createdAt})`.as("last_session"),
    })
    .from(sessions)
    .groupBy(sessions.userId);
  const statsByUserId = new Map(stats.map((s) => [s.userId, s]));
  return students.map((student) => {
    const stat = statsByUserId.get(student.id);
    return {
      id: student.id,
      name: student.name,
      email: student.email,
      discordUsername: student.discordUsername,
      discordAvatarUrl: student.discordAvatarUrl,
      sessionCount: stat?.sessionCount ?? 0,
      bestLapTimeSeconds: stat?.bestLapTimeSeconds ?? null,
      lastSessionAt: stat?.lastSessionAt ?? null,
    };
  });
}

export async function getSessionsForUser(userId: number) {
  return db.query.sessions.findMany({
    where: eq(sessions.userId, userId),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  });
}

export async function getReferenceLapsForUser(userId: number) {
  return db.query.referenceLaps.findMany({
    where: eq(referenceLaps.ownerId, userId),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });
}

export async function getPublicReferenceLaps() {
  return db.query.referenceLaps.findMany({
    where: eq(referenceLaps.isPublic, true),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });
}

export async function getStudentDetail(studentId: number) {
  const student = await db.query.users.findFirst({
    where: and(eq(users.id, studentId), eq(users.role, "student")),
  });
  if (!student) return null;
  const studentSessions = await getSessionsForUser(studentId);
  const studentLaps = await getReferenceLapsForUser(studentId);
  return { student, sessions: studentSessions, referenceLaps: studentLaps };
}

/**
 * One session plus every other session the same user drove at the same
 * track. The detail page needs both: the lap itself is meaningless
 * without the laps around it to compare against.
 */
export async function getSessionWithTrackHistory(sessionId: number) {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  if (!session) return null;
  const sameTrack = await db.query.sessions.findMany({
    where: and(eq(sessions.userId, session.userId), eq(sessions.track, session.track)),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  });
  return { session, sameTrack };
}

// Create a reference lap. Used both by the local telemetry app's API
// upload (owner-only, isPublic optional, no carDisplay) and by the
// coach-facing "Global reference laps" page (always isPublic: true,
// carDisplay typed in by the coach).
export async function createReferenceLap(input: {
  ownerId: number;
  track: string;
  car: string;
  carDisplay?: string | null;
  label: string;
  data: unknown;
  lapTimeSeconds: number | null;
  isPublic: boolean;
}) {
  const [created] = await db
    .insert(referenceLaps)
    .values({ ...input, carDisplay: input.carDisplay ?? null })
    .returning({ id: referenceLaps.id });
  return created;
}

// Remove a reference lap -- used by the coach's "Global reference laps"
// page to take a lap out of circulation for everyone.
export async function deleteReferenceLap(id: number) {
  await db.delete(referenceLaps).where(eq(referenceLaps.id, id));
}

// Lightweight listing for the local telemetry bridge app: every lap this
// user can drive against (their own + every global/public one), WITHOUT
// the heavy per-bin `data` blob -- the app fetches that separately, only
// for the one lap the student actually picks. Keeps the "which laps are
// available" call fast even as the library of global laps grows.
export async function getAvailableReferenceLaps(userId: number) {
  return db.query.referenceLaps.findMany({
    where: or(eq(referenceLaps.ownerId, userId), eq(referenceLaps.isPublic, true)),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
    columns: {
      id: true,
      ownerId: true,
      track: true,
      car: true,
      carDisplay: true,
      label: true,
      lapTimeSeconds: true,
      isPublic: true,
      createdAt: true,
      // data intentionally omitted -- see getReferenceLapForDownload
    },
  });
}

// Full lap (including the per-bin `data` blob) for the local app to load
// once a student has picked a specific reference lap to drive against.
// Access check: must be the lap's owner, or the lap must be public --
// this is what stops one student pulling another private lap by guessing
// an id.
export async function getReferenceLapForDownload(id: number, userId: number) {
  const lap = await db.query.referenceLaps.findFirst({ where: eq(referenceLaps.id, id) });
  if (!lap) return null;
  if (lap.ownerId !== userId && !lap.isPublic) return null;
  return lap;
}

// ---------------------------------------------------------------- library

// One row per track that has at least one published lap, for the track
// grid. Two queries rather than one: the listing needs no telemetry, and
// pulling every lap's full sample blob just to count them would move
// megabytes to render a page of thumbnails. The second query fetches
// data for only the representative lap per track that draws the layout.
export async function getTrackSummaries() {
  const laps = await db.query.referenceLaps.findMany({
    where: eq(referenceLaps.isPublic, true),
    orderBy: (r, { asc }) => [asc(r.lapTimeSeconds)],
    columns: { id: true, track: true, lapTimeSeconds: true },
  });

  const byTrack = new Map<string, { lapCount: number; bestLapTimeSeconds: number | null; sampleId: number }>();
  for (const lap of laps) {
    const existing = byTrack.get(lap.track);
    if (existing) {
      existing.lapCount += 1;
      if (existing.bestLapTimeSeconds === null || (lap.lapTimeSeconds !== null && lap.lapTimeSeconds < existing.bestLapTimeSeconds)) {
        existing.bestLapTimeSeconds = lap.lapTimeSeconds;
      }
    } else {
      byTrack.set(lap.track, { lapCount: 1, bestLapTimeSeconds: lap.lapTimeSeconds, sampleId: lap.id });
    }
  }
  if (byTrack.size === 0) return [];

  const sampleIds = [...byTrack.values()].map((v) => v.sampleId);
  const samples = await db.query.referenceLaps.findMany({
    where: inArray(referenceLaps.id, sampleIds),
    columns: { id: true, data: true },
  });
  const dataById = new Map(samples.map((s) => [s.id, s.data]));

  return [...byTrack.entries()]
    .map(([track, v]) => ({
      track,
      lapCount: v.lapCount,
      bestLapTimeSeconds: v.bestLapTimeSeconds,
      sampleData: dataById.get(v.sampleId) ?? null,
    }))
    .sort((a, b) => a.track.localeCompare(b.track));
}

// Every published lap for one track, plus one lap's data to draw the
// layout from.
export async function getPublicLapsForTrack(track: string) {
  const laps = await db.query.referenceLaps.findMany({
    where: and(eq(referenceLaps.isPublic, true), eq(referenceLaps.track, track)),
    orderBy: (r, { asc }) => [asc(r.lapTimeSeconds)],
    columns: {
      id: true, track: true, car: true, carDisplay: true,
      label: true, lapTimeSeconds: true, createdAt: true,
    },
  });
  if (laps.length === 0) return { laps, sampleData: null };

  const sample = await db.query.referenceLaps.findFirst({
    where: eq(referenceLaps.id, laps[0].id),
    columns: { data: true },
  });
  return { laps, sampleData: sample?.data ?? null };
}

// ------------------------------------------------------- track progress

/**
 * The racing class out of a car string, or null if it can't be told.
 *
 * The app builds car names as "<class> . <entry>" (e.g.
 * "GT3 . Iron Lynx 2025 #63:ELMS"), so the class is the part before the
 * separator. Laps uploaded through the website are typed by hand and
 * often have no class at all, hence the keyword sweep as a second try,
 * and null as an honest third answer rather than a guess.
 */
function carClass(car: string | null | undefined): string | null {
  if (!car) return null;

  const parts = car.split(/[\u00b7|]/);
  if (parts.length > 1 && parts[0].trim()) {
    return parts[0].trim().toUpperCase();
  }

  const known = ["HYPERCAR", "LMDH", "LMH", "LMP2", "LMP3", "GTE", "GT3", "GT4"];
  const upper = car.toUpperCase();
  for (const name of known) {
    if (upper.includes(name)) return name;
  }
  return null;
}

/**
 * Whether a lap in one car can fairly be compared to a reference set in
 * another: same class only. A GT3 driver measured against a Hypercar
 * reference would see a gap they can never close, which is worse than
 * showing no gap at all.
 *
 * When either side's class is unknown the comparison is allowed. That's
 * deliberate -- refusing would leave most rows blank, since laps typed
 * in through the website rarely carry a class.
 */
function sameClass(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = carClass(a);
  const cb = carClass(b);
  if (ca === null || cb === null) return true;
  return ca === cb;
}

export type TrackProgress = {
  track: string;
  carClass: string | null;
  car: string;              // the car they most recently drove here
  lapCount: number;
  bestLapTimeSeconds: number | null;
  referenceLapTimeSeconds: number | null;
  gapSeconds: number | null;   // yours minus the reference; negative means faster
};

/**
 * One row per track and class this driver has laps in, with the gap to
 * the best published reference for the same track and class.
 *
 * Per track/class rather than overall, because a lap time only means
 * something against the same circuit and machinery -- an aggregate
 * "fastest lap" across tracks compares numbers that aren't comparable.
 * The gap IS comparable across rows, which is what makes it worth
 * sorting on: the biggest gap is where there's most to gain.
 */
export async function getTrackProgress(userId: number): Promise<TrackProgress[]> {
  const [drivenLaps, references] = await Promise.all([
    db.query.sessions.findMany({
      where: eq(sessions.userId, userId),
      columns: { track: true, car: true, lapTimeSeconds: true, createdAt: true },
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    }),
    db.query.referenceLaps.findMany({
      where: eq(referenceLaps.isPublic, true),
      columns: { track: true, car: true, lapTimeSeconds: true },
    }),
  ]);

  const groups = new Map<string, TrackProgress>();

  for (const lap of drivenLaps) {
    const cls = carClass(lap.car);
    const key = `${lap.track}||${cls ?? ""}`;
    let row = groups.get(key);
    if (!row) {
      row = {
        track: lap.track,
        carClass: cls,
        car: lap.car,        // sessions come back newest first, so this
        lapCount: 0,         // is the car they drove here most recently
        bestLapTimeSeconds: null,
        referenceLapTimeSeconds: null,
        gapSeconds: null,
      };
      groups.set(key, row);
    }
    row.lapCount += 1;
    if (
      lap.lapTimeSeconds !== null &&
      (row.bestLapTimeSeconds === null || lap.lapTimeSeconds < row.bestLapTimeSeconds)
    ) {
      row.bestLapTimeSeconds = lap.lapTimeSeconds;
    }
  }

  for (const row of groups.values()) {
    let best: number | null = null;
    for (const ref of references) {
      if (ref.track !== row.track) continue;
      if (!sameClass(ref.car, row.car)) continue;
      if (ref.lapTimeSeconds === null) continue;
      if (best === null || ref.lapTimeSeconds < best) best = ref.lapTimeSeconds;
    }
    row.referenceLapTimeSeconds = best;
    row.gapSeconds =
      best !== null && row.bestLapTimeSeconds !== null ? row.bestLapTimeSeconds - best : null;
  }

  // Biggest gap first -- that's where the time is. Rows with no
  // reference to compare against sort last; they're not a finding.
  return [...groups.values()].sort((a, b) => {
    if (a.gapSeconds === null && b.gapSeconds === null) return a.track.localeCompare(b.track);
    if (a.gapSeconds === null) return 1;
    if (b.gapSeconds === null) return -1;
    return b.gapSeconds - a.gapSeconds;
  });
}