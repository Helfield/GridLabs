import { db } from "./client";
import { users, sessions, referenceLaps } from "./schema";
import { eq, and, inArray, isNotNull, asc } from "drizzle-orm";
import { carClass, sameClass } from "./queries";

// ------------------------------------------------------------ validation
//
// Same three numbers as the local app's lap_history.py (worth_keeping):
// MIN/MAX plausible lap duration and the standstill speed floor. Kept
// identical on purpose -- "what counts as a real lap" should mean the
// same thing everywhere in this system, not just on the machine that
// happened to record it. This is website-side DEFENSE IN DEPTH: the
// local app now gates this before it ever uploads, but a session from
// an older un-updated exe, or any other way a row could land in this
// table, should still be caught here rather than trusted blindly.

export const MIN_PLAUSIBLE_LAP_SECONDS = 20;
export const MAX_PLAUSIBLE_LAP_SECONDS = 600;
export const STANDSTILL_KPH = 5;

export function isPlausibleLapTime(seconds: number | null | undefined): boolean {
  if (seconds === null || seconds === undefined) return false;
  return seconds >= MIN_PLAUSIBLE_LAP_SECONDS && seconds <= MAX_PLAUSIBLE_LAP_SECONDS;
}

/**
 * Whether a lap's own telemetry contains a standstill sample -- an
 * out-lap, an in-lap, or a spin, all of which a genuine flying lap never
 * does. Reads the same `samples: { [bin]: { speed_kph } }` shape
 * session-pages.ts's own readSamples() already parses this data as.
 *
 * Tolerant of anything malformed: a lap with no data, or data that
 * isn't shaped as expected, is treated as "can't find a standstill in
 * it" rather than rejected on that basis alone -- the duration check
 * above is what actually keeps out-laps out; this only catches the
 * ones a duration check alone would miss (a spin mid-lap that's still
 * within a plausible total time).
 */
export function hasStandstillSample(data: unknown): boolean {
  const samples = (data as any)?.samples;
  if (!samples || typeof samples !== "object") return false;
  for (const key of Object.keys(samples)) {
    const speed = samples[key]?.speed_kph;
    if (typeof speed === "number" && speed < STANDSTILL_KPH) return true;
  }
  return false;
}

export function isValidLap(lapTimeSeconds: number | null | undefined, data: unknown): boolean {
  if (!isPlausibleLapTime(lapTimeSeconds)) return false;
  if (hasStandstillSample(data)) return false;
  return true;
}

/**
 * Whether a lap carries enough telemetry to be driven against. A
 * reference lap is a file the app loads and follows around the circuit,
 * so a session uploaded without its per-bin data (older app builds, or
 * a failed attach) can sit on the leaderboard but can't be published as
 * a reference -- there'd be nothing to download.
 */
export function hasUsableTelemetry(data: unknown): boolean {
  const samples = (data as any)?.samples;
  return !!samples && typeof samples === "object" && Object.keys(samples).length >= 10;
}

// -------------------------------------------------------- promotion decision

export type PromotionDecision =
  | { action: "skip"; reason: string }
  | { action: "promote"; reason: string }
  | { action: "pending_approval"; reason: string };

/**
 * Pure decision, no database access -- given what the current public
 * reference for this track/class looks like (or that there isn't one),
 * decide what should happen with a new, already-validated session lap.
 * Kept separate from evaluateSessionForPromotion's actual DB reads and
 * writes so this can be tested directly against plain objects.
 *
 * The fastest valid lap in a track/class simply becomes its public
 * reference, whoever set the previous one. That includes a coach-typed
 * reference: promoting adds a faster lap alongside it rather than
 * removing it, so nothing the coach curated is lost -- the faster lap
 * just becomes the one drivers are compared against. (This used to
 * hold such laps for coach approval, but no page ever showed that
 * queue, so those laps were parked forever.)
 */
export function decidePromotion(input: {
  lapTimeSeconds: number;
  currentReference: { lapTimeSeconds: number | null; autoPromoted: boolean } | null;
}): PromotionDecision {
  const ref = input.currentReference;

  if (!ref || ref.lapTimeSeconds === null) {
    return { action: "promote", reason: "no existing public reference for this track and class" };
  }
  if (input.lapTimeSeconds >= ref.lapTimeSeconds) {
    return { action: "skip", reason: "not faster than the current reference" };
  }
  return { action: "promote", reason: "faster than the current reference" };
}

// ------------------------------------------------------------- DB orchestration

/**
 * The current best public reference for a track and EXACT car class, or
 * null. Strict on purpose: getReferenceForComparison lets an unknown
 * class match anything (so hand-typed laps still get compared), but for
 * deciding what to publish that leniency would let a class-less lap
 * block a whole class, or a GT3 time compete with an LMP2 one.
 */
async function getCurrentPublicReference(track: string, cls: string) {
  const candidates = await db.query.referenceLaps.findMany({
    where: and(eq(referenceLaps.isPublic, true), eq(referenceLaps.track, track)),
    columns: { id: true, car: true, lapTimeSeconds: true, autoPromoted: true },
  });
  const eligible = candidates
    .filter((r) => carClass(r.car) === cls && r.lapTimeSeconds !== null)
    .sort((x, y) => (x.lapTimeSeconds ?? Infinity) - (y.lapTimeSeconds ?? Infinity));
  return eligible[0] ?? null;
}

/**
 * Call this once, after a session row has been inserted (and from the
 * backfill below). Validates the lap and, if it is the fastest for its
 * track and car class, publishes it as that class's reference lap.
 *
 * Does NOT touch the session's own row or delete/unpublish any existing
 * reference lap -- getReferenceForComparison and getCurrentPublicReference
 * both pick the FASTEST public lap for a track/class, so an older,
 * now-slower lap simply stops being selected once a faster one exists;
 * there's nothing to clean up for that to work.
 */
export async function evaluateSessionForPromotion(session: {
  id: number;
  userId: number;
  track: string;
  car: string;
  lapTimeSeconds: number | null;
  data: unknown;
}): Promise<PromotionDecision> {
  if (!isValidLap(session.lapTimeSeconds, session.data)) {
    return { action: "skip", reason: "lap failed validation (implausible duration or a standstill)" };
  }
  const cls = carClass(session.car);
  if (!cls) {
    return { action: "skip", reason: "car class unknown, so there's nothing fair to rank it against" };
  }
  if (!hasUsableTelemetry(session.data)) {
    return { action: "skip", reason: "no telemetry attached, so it couldn't be driven against" };
  }
  // isValidLap already confirmed this is a number, but TypeScript can't
  // narrow across the function boundary.
  const lapTimeSeconds = session.lapTimeSeconds as number;

  const currentReference = await getCurrentPublicReference(session.track, cls);
  const decision = decidePromotion({ lapTimeSeconds, currentReference });
  if (decision.action !== "promote") return decision;

  const owner = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  await db.insert(referenceLaps).values({
    ownerId: session.userId,
    track: session.track,
    car: session.car,
    carDisplay: null,
    label: `Fastest by ${owner?.name ?? "a student"} -- ${formatLapTime(lapTimeSeconds)}`,
    data: session.data,
    lapTimeSeconds,
    isPublic: true,
    autoPromoted: true,
    sourceSessionId: session.id,
  });
  return decision;
}

/**
 * Publish the fastest valid lap for every track/class from laps already
 * on the site. Uploads are handled as they arrive; this catches
 * everything that was driven before that was wired up, and anything an
 * upload-time check missed. Idempotent: a lap that's already the
 * reference isn't faster than itself, so re-running does nothing.
 *
 * Walks each class fastest-first and takes the first lap that is valid
 * AND carries telemetry -- a driver's quickest time is sometimes an
 * out-lap or a lap uploaded without data, and the next one down is
 * the one that counts.
 */
export async function promoteBestLaps(): Promise<{ promoted: number; tracks: number }> {
  const trackRows = await db
    .selectDistinct({ track: sessions.track })
    .from(sessions)
    .where(isNotNull(sessions.lapTimeSeconds));

  let promoted = 0;
  for (const { track } of trackRows) {
    if (!track || track === "Unknown Track") continue;
    // Summary columns only -- `data` is the whole lap's telemetry, so it
    // is fetched one row at a time and only for laps in contention.
    const candidates = await db.query.sessions.findMany({
      where: and(eq(sessions.track, track), isNotNull(sessions.lapTimeSeconds)),
      columns: { id: true, userId: true, car: true, lapTimeSeconds: true },
      orderBy: [asc(sessions.lapTimeSeconds)],
    });

    const done = new Set<string>();
    for (const s of candidates) {
      const cls = carClass(s.car);
      if (!cls || done.has(cls)) continue;
      const full = await db.query.sessions.findFirst({ where: eq(sessions.id, s.id), columns: { data: true } });
      if (!isValidLap(s.lapTimeSeconds, full?.data) || !hasUsableTelemetry(full?.data)) continue;
      done.add(cls);
      const decision = await evaluateSessionForPromotion({ ...s, track, data: full?.data });
      if (decision.action === "promote") promoted += 1;
    }
  }
  return { promoted, tracks: trackRows.length };
}

function formatLapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return minutes > 0 ? `${minutes}:${rest.toFixed(3).padStart(6, "0")}` : rest.toFixed(3);
}

/**
 * Coach-only manual override: publish this exact session's lap as a
 * public reference RIGHT NOW, regardless of what decidePromotion() would
 * have said. This is for a coach who has actually looked at the lap
 * breakdown on /session/:id and decided it's worth sharing -- not the
 * automatic beat-the-current-reference logic above, which only fires on
 * upload and only for laps that are already faster than what's live.
 *
 * Still marked autoPromoted: true, same as evaluateSessionForPromotion's
 * own inserts -- this is a student-sourced lap, so a later genuinely
 * faster student lap should be free to replace it automatically rather
 * than needing another manual approval. autoPromoted: false is reserved
 * for laps a coach typed in by hand via the "Global reference laps" form.
 */
export async function promoteSessionToReference(
  sessionId: number,
): Promise<{ ok: true; referenceLapId: number } | { ok: false; reason: string }> {
  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
  if (!session) return { ok: false, reason: "Session not found." };
  if (session.lapTimeSeconds === null) {
    return { ok: false, reason: "This lap has no recorded time and can't be published." };
  }

  const owner = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  const [created] = await db
    .insert(referenceLaps)
    .values({
      ownerId: session.userId,
      track: session.track,
      car: session.car,
      carDisplay: null,
      label: `Fastest by ${owner?.name ?? "a student"} -- ${formatLapTime(session.lapTimeSeconds)}`,
      data: session.data,
      lapTimeSeconds: session.lapTimeSeconds,
      isPublic: true,
      autoPromoted: true,
      sourceSessionId: session.id,
    })
    .returning({ id: referenceLaps.id });

  return { ok: true, referenceLapId: created.id };
}

// --------------------------------------------------------------- leaderboard

/**
 * Best lap per owner, from a flat list -- the piece that actually
 * enforces "no single person gets two spots". Pure and generic so it's
 * testable directly with plain objects, no database involved.
 */
export function bestPerOwner<T extends { ownerId: number; lapTimeSeconds: number | null }>(
  laps: T[],
): T[] {
  const bestByOwner = new Map<number, T>();
  for (const lap of laps) {
    if (lap.lapTimeSeconds === null) continue;
    const existing = bestByOwner.get(lap.ownerId);
    if (!existing || lap.lapTimeSeconds < (existing.lapTimeSeconds as number)) {
      bestByOwner.set(lap.ownerId, lap);
    }
  }
  return [...bestByOwner.values()];
}

/** Fastest N by lapTimeSeconds, nulls sorted last. Pure, testable. */
export function fastestN<T extends { lapTimeSeconds: number | null }>(laps: T[], n: number): T[] {
  return [...laps]
    .sort((a, b) => (a.lapTimeSeconds ?? Infinity) - (b.lapTimeSeconds ?? Infinity))
    .slice(0, n);
}

export type LeaderboardEntry = {
  referenceLapId: number;
  ownerId: number;
  ownerName: string;
  lapTimeSeconds: number;
  label: string;
  autoPromoted: boolean;
  createdAt: Date;
};

/**
 * Top N public reference laps for a track/class, one entry per driver --
 * their own best only, so a driver can't hold multiple leaderboard spots
 * with one fast lap and several slower ones. Built from referenceLaps
 * (published laps only), not raw sessions -- the leaderboard is about
 * what's actually downloadable/viewable as a reference, matching how
 * "top 5... other students have the option to download it" was asked
 * for, not a log of every lap anyone's ever driven.
 */
export async function getLeaderboard(
  track: string,
  car: string,
  limit = 5,
): Promise<LeaderboardEntry[]> {
  const candidates = await db.query.referenceLaps.findMany({
    where: and(eq(referenceLaps.isPublic, true), eq(referenceLaps.track, track)),
    columns: {
      id: true, ownerId: true, car: true, label: true,
      lapTimeSeconds: true, autoPromoted: true, createdAt: true,
    },
  });

  const matching = candidates.filter((r) => sameClass(r.car, car));
  const top = fastestN(bestPerOwner(matching), limit);

  const ownerIds = [...new Set(top.map((l) => l.ownerId))];
  const owners = ownerIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, ownerIds), columns: { id: true, name: true } })
    : [];
  const nameByOwnerId = new Map(owners.map((u) => [u.id, u.name]));

  return top.map((lap) => ({
    referenceLapId: lap.id,
    ownerId: lap.ownerId,
    ownerName: nameByOwnerId.get(lap.ownerId) ?? "Unknown",
    lapTimeSeconds: lap.lapTimeSeconds as number,
    label: lap.label,
    autoPromoted: lap.autoPromoted,
    createdAt: lap.createdAt,
  }));
}