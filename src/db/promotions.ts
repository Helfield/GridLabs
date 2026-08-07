import { db } from "./client";
import { users, sessions, referenceLaps, promotionApprovals } from "./schema";
import { eq, and, inArray } from "drizzle-orm";
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
 * The approval boundary: nothing to protect -> promote automatically.
 * Beating another AUTO-PROMOTED reference -> promote automatically,
 * fastest among student-set laps just wins. Beating a COACH-SET
 * reference (autoPromoted: false) -> flagged for approval instead of
 * silently replacing something curated by hand.
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
  if (!ref.autoPromoted) {
    return { action: "pending_approval", reason: "would replace a coach-uploaded reference" };
  }
  return { action: "promote", reason: "faster than the current auto-promoted reference" };
}

// ------------------------------------------------------------- DB orchestration

/**
 * The current best public reference for a track/class, or null. Same
 * matching (isPublic + same track + sameClass) getReferenceForComparison
 * already uses in queries.ts, reused rather than re-derived so "what
 * counts as the reference right now" can never quietly diverge between
 * the two call sites.
 */
async function getCurrentPublicReference(track: string, car: string) {
  const candidates = await db.query.referenceLaps.findMany({
    where: and(eq(referenceLaps.isPublic, true), eq(referenceLaps.track, track)),
    columns: { id: true, car: true, lapTimeSeconds: true, autoPromoted: true },
  });
  const eligible = candidates
    .filter((r) => sameClass(r.car, car) && r.lapTimeSeconds !== null)
    .sort((a, b) => (a.lapTimeSeconds ?? Infinity) - (b.lapTimeSeconds ?? Infinity));
  return eligible[0] ?? null;
}

/**
 * Call this once, after a session row has been inserted. Validates the
 * lap, decides what should happen, and either does nothing, inserts a
 * new public auto-promoted reference lap, or raises a promotion_approvals
 * row for the coach.
 *
 * Does NOT touch the session's own row or delete/unpublish any existing
 * reference lap -- getReferenceForComparison and getCurrentPublicReference
 * both already pick the FASTEST public lap for a track/class, so an
 * older, now-slower auto-promoted lap simply stops being selected once a
 * faster one exists; there's nothing to clean up for that to work.
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
  // isValidLap already confirmed this is a number, but TypeScript can't
  // narrow across the function boundary.
  const lapTimeSeconds = session.lapTimeSeconds as number;

  const currentReference = await getCurrentPublicReference(session.track, session.car);
  const decision = decidePromotion({ lapTimeSeconds, currentReference });

  if (decision.action === "skip") {
    return decision;
  }

  if (decision.action === "promote") {
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

  // pending_approval -- currentReference must be non-null here, since
  // decidePromotion only returns this action when there's a reference
  // to be replacing (see its own branches above).
  await db.insert(promotionApprovals).values({
    sessionId: session.id,
    track: session.track,
    carClass: carClass(session.car),
    lapTimeSeconds,
    currentReferenceLapId: currentReference!.id,
    currentReferenceLapTimeSeconds: currentReference!.lapTimeSeconds as number,
    status: "pending",
  });
  return decision;
}

function formatLapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return minutes > 0 ? `${minutes}:${rest.toFixed(3).padStart(6, "0")}` : rest.toFixed(3);
}

// ------------------------------------------------------------- approval queue

export type PendingApproval = {
  id: number;
  sessionId: number;
  track: string;
  carClass: string | null;
  lapTimeSeconds: number;
  currentReferenceLapId: number;
  currentReferenceLapTimeSeconds: number;
  driverName: string;
  createdAt: Date;
};

export async function getPendingApprovals(): Promise<PendingApproval[]> {
  const pending = await db.query.promotionApprovals.findMany({
    where: eq(promotionApprovals.status, "pending"),
    orderBy: (p, { asc }) => [asc(p.createdAt)],
  });
  if (pending.length === 0) return [];

  const sessionIds = pending.map((p) => p.sessionId);
  const relatedSessions = await db.query.sessions.findMany({
    where: inArray(sessions.id, sessionIds),
    columns: { id: true, userId: true },
  });
  const userIdBySession = new Map(relatedSessions.map((s) => [s.id, s.userId]));

  const userIds = [...new Set(relatedSessions.map((s) => s.userId))];
  const owners = userIds.length
    ? await db.query.users.findMany({ where: inArray(users.id, userIds), columns: { id: true, name: true } })
    : [];
  const nameByUserId = new Map(owners.map((u) => [u.id, u.name]));

  return pending.map((p) => {
    const userId = userIdBySession.get(p.sessionId);
    return {
      id: p.id,
      sessionId: p.sessionId,
      track: p.track,
      carClass: p.carClass,
      lapTimeSeconds: p.lapTimeSeconds,
      currentReferenceLapId: p.currentReferenceLapId,
      currentReferenceLapTimeSeconds: p.currentReferenceLapTimeSeconds,
      driverName: (userId !== undefined && nameByUserId.get(userId)) || "Unknown driver",
      createdAt: p.createdAt,
    };
  });
}

/** Coach approves: the session's lap becomes the new public reference. */
export async function approvePromotion(approvalId: number): Promise<boolean> {
  const approval = await db.query.promotionApprovals.findFirst({
    where: eq(promotionApprovals.id, approvalId),
  });
  if (!approval || approval.status !== "pending") return false;

  const session = await db.query.sessions.findFirst({ where: eq(sessions.id, approval.sessionId) });
  if (!session) return false;

  const owner = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  await db.insert(referenceLaps).values({
    ownerId: session.userId,
    track: session.track,
    car: session.car,
    carDisplay: null,
    label: `Fastest by ${owner?.name ?? "a student"} -- ${formatLapTime(approval.lapTimeSeconds)}`,
    data: session.data,
    lapTimeSeconds: approval.lapTimeSeconds,
    isPublic: true,
    autoPromoted: true,
    sourceSessionId: session.id,
  });

  await db
    .update(promotionApprovals)
    .set({ status: "approved", resolvedAt: new Date() })
    .where(eq(promotionApprovals.id, approvalId));
  return true;
}

/** Coach rejects: nothing changes about the reference laps; just marks it decided. */
export async function rejectPromotion(approvalId: number): Promise<boolean> {
  const approval = await db.query.promotionApprovals.findFirst({
    where: eq(promotionApprovals.id, approvalId),
  });
  if (!approval || approval.status !== "pending") return false;

  await db
    .update(promotionApprovals)
    .set({ status: "rejected", resolvedAt: new Date() })
    .where(eq(promotionApprovals.id, approvalId));
  return true;
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