import { db } from "./client";
import { users, leagues, leagueEntries, leagueEvents, leagueResults, raceResults, leagueCalendarEvents } from "./schema";
import { eq, and, asc, desc, inArray, gte, lte, isNotNull, sql } from "drizzle-orm";
import { calendarEnabled, upsertCalendarEvent, deleteCalendarEvent } from "../googleCalendar";
import { siteUrl } from "../siteUrl";

/**
 * League data: registration, the schedule, results entered by the
 * organisers, points, and the cross-check against what the desktop app
 * recorded when each driver finished a race.
 *
 * Points are always computed here from the league's own scoring rules and
 * stored on the result, so changing a rule means re-saving an event's
 * results (see recalculateLeague) rather than every page recomputing.
 */

export type League = typeof leagues.$inferSelect;
export type LeagueEvent = typeof leagueEvents.$inferSelect;
export type ResultStatus = "finished" | "dnf" | "dns" | "dsq";
export const RESULT_STATUSES: ResultStatus[] = ["finished", "dnf", "dns", "dsq"];

/** LMU licence bands for SR and DR, lowest to highest. What registration offers as choices. */
export const LICENCE_BANDS: string[] = [
  "Bronze 1",
  "Bronze 2",
  "Bronze 3",
  "Silver 1",
  "Silver 2",
  "Silver 3",
  "Gold 1",
  "Gold 2",
  "Gold 3",
  "Platinum 1",
  "Platinum 2",
  "Platinum 3",
];

/** The staff roles: a coach has the lot, a moderator runs events and results. */
export function isStaff(role: string | null | undefined): boolean {
  return role === "coach" || role === "moderator";
}

export function parsePointsTable(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => Math.round(n));
}

export function computePoints(
  league: Pick<League, "pointsTable" | "fastestLapBonus" | "poleBonus" | "participationPoints">,
  r: { position: number | null; status: string; fastestLap: boolean; pole: boolean; adjustment: number },
): number {
  // A driver who didn't start, or was disqualified, scores nothing -- not even bonuses.
  if (r.status === "dns" || r.status === "dsq") return Math.min(0, r.adjustment);
  let points = 0;
  if (r.status === "finished" && r.position && r.position > 0) {
    const table = parsePointsTable(league.pointsTable);
    points = table[r.position - 1] ?? league.participationPoints;
  } else {
    points = league.participationPoints;
  }
  if (r.fastestLap) points += league.fastestLapBonus;
  if (r.pole) points += league.poleBonus;
  return points + r.adjustment;
}

export async function listLeagues() {
  const rows = await db.select().from(leagues).orderBy(desc(leagues.createdAt));
  const counts = await db
    .select({ leagueId: leagueEntries.leagueId, n: sql<number>`count(*)::int` })
    .from(leagueEntries)
    .groupBy(leagueEntries.leagueId);
  const byLeague = new Map(counts.map((c) => [c.leagueId, c.n]));
  return rows.map((l) => ({ ...l, entryCount: byLeague.get(l.id) ?? 0 }));
}

export async function getLeague(id: number) {
  return db.query.leagues.findFirst({ where: eq(leagues.id, id) });
}

export async function getEntries(leagueId: number) {
  return db
    .select({
      id: leagueEntries.id,
      userId: leagueEntries.userId,
      team: leagueEntries.team,
      srBand: leagueEntries.srBand,
      drBand: leagueEntries.drBand,
      name: users.name,
      discordUsername: users.discordUsername,
      discordAvatarUrl: users.discordAvatarUrl,
    })
    .from(leagueEntries)
    .innerJoin(users, eq(users.id, leagueEntries.userId))
    .where(eq(leagueEntries.leagueId, leagueId))
    .orderBy(asc(users.name));
}

export type Entry = Awaited<ReturnType<typeof getEntries>>[number];

export async function getEvents(leagueId: number) {
  return db.select().from(leagueEvents).where(eq(leagueEvents.leagueId, leagueId)).orderBy(asc(leagueEvents.round));
}

export async function getEvent(eventId: number) {
  return db.query.leagueEvents.findFirst({ where: eq(leagueEvents.id, eventId) });
}

export async function getEventResults(eventId: number) {
  return db
    .select({
      userId: leagueResults.userId,
      position: leagueResults.position,
      status: leagueResults.status,
      fastestLap: leagueResults.fastestLap,
      pole: leagueResults.pole,
      adjustment: leagueResults.adjustment,
      points: leagueResults.points,
      name: users.name,
    })
    .from(leagueResults)
    .innerJoin(users, eq(users.id, leagueResults.userId))
    .where(eq(leagueResults.eventId, eventId));
}

export type EventResult = Awaited<ReturnType<typeof getEventResults>>[number];

export type StandingRow = {
  userId: number;
  name: string;
  team: string | null;
  srBand: string | null;
  drBand: string | null;
  points: number;
  wins: number;
  podiums: number;
  rounds: number;
  /** Points per event id, for the results grid. */
  byEvent: Map<number, number>;
};

/** Championship table: every registered driver, by total points, then wins, then podiums. */
export async function getStandings(leagueId: number, events: LeagueEvent[]): Promise<StandingRow[]> {
  const entries = await getEntries(leagueId);
  const eventIds = events.map((e) => e.id);
  const results = eventIds.length
    ? await db.select().from(leagueResults).where(inArray(leagueResults.eventId, eventIds))
    : [];

  const rows = new Map<number, StandingRow>();
  for (const e of entries) {
    rows.set(e.userId, {
      userId: e.userId,
      name: e.name,
      team: e.team,
      srBand: e.srBand,
      drBand: e.drBand,
      points: 0,
      wins: 0,
      podiums: 0,
      rounds: 0,
      byEvent: new Map(),
    });
  }
  for (const r of results) {
    const row = rows.get(r.userId);
    if (!row) continue; // withdrew after scoring: their results stay on file but off the table
    row.points += r.points;
    row.byEvent.set(r.eventId, r.points);
    if (r.status !== "dns") row.rounds += 1;
    if (r.status === "finished" && r.position === 1) row.wins += 1;
    if (r.status === "finished" && r.position !== null && r.position <= 3) row.podiums += 1;
  }
  return [...rows.values()].sort(
    (a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || a.name.localeCompare(b.name),
  );
}

export async function isRegistered(leagueId: number, userId: number): Promise<boolean> {
  const row = await db.query.leagueEntries.findFirst({
    where: and(eq(leagueEntries.leagueId, leagueId), eq(leagueEntries.userId, userId)),
    columns: { id: true },
  });
  return !!row;
}

/**
 * Save one event's results from the staff form. `rows` holds only the
 * drivers the organiser filled in; anyone left out has any earlier result
 * for this event removed, so clearing a row clears the result.
 *
 * Returns an error message when the finishing positions don't make sense
 * (two drivers in the same place), without saving anything.
 */
export async function saveEventResults(
  league: League,
  eventId: number,
  enteredBy: number,
  rows: Array<{ userId: number; position: number | null; status: ResultStatus; fastestLap: boolean; pole: boolean; adjustment: number }>,
): Promise<string | null> {
  const seen = new Set<number>();
  for (const r of rows) {
    if (r.status === "finished") {
      if (!r.position || r.position < 1) return "Every finisher needs a finishing position.";
      if (seen.has(r.position)) return `Two drivers are down for P${r.position}.`;
      seen.add(r.position);
    }
  }

  await db.transaction(async (tx) => {
    const keep = rows.map((r) => r.userId);
    if (keep.length) {
      await tx
        .delete(leagueResults)
        .where(and(eq(leagueResults.eventId, eventId), sql`${leagueResults.userId} not in (${sql.join(keep.map((k) => sql`${k}`), sql`, `)})`));
    } else {
      await tx.delete(leagueResults).where(eq(leagueResults.eventId, eventId));
    }
    for (const r of rows) {
      const position = r.status === "finished" ? r.position : null;
      const values = {
        eventId,
        userId: r.userId,
        position,
        status: r.status,
        fastestLap: r.fastestLap,
        pole: r.pole,
        adjustment: r.adjustment,
        points: computePoints(league, { ...r, position }),
        enteredBy,
        updatedAt: new Date(),
      };
      await tx
        .insert(leagueResults)
        .values(values)
        .onConflictDoUpdate({ target: [leagueResults.eventId, leagueResults.userId], set: values });
    }
  });
  return null;
}

/** Re-score every stored result in a league, after its points rules change. */
export async function recalculateLeague(league: League): Promise<void> {
  const events = await getEvents(league.id);
  if (!events.length) return;
  const rows = await db
    .select()
    .from(leagueResults)
    .where(inArray(leagueResults.eventId, events.map((e) => e.id)));
  for (const r of rows) {
    await db
      .update(leagueResults)
      .set({ points: computePoints(league, r) })
      .where(eq(leagueResults.id, r.id));
  }
}

// ---------------------------------------------------------------- cross-check

export type AppRaceRecord = {
  place: number;
  classPlace: number | null;
  finishStatus: number;
  laps: number | null;
  fieldSize: number | null;
  car: string;
  at: Date;
  classification: unknown;
};

/** How many hours either side of the event date a race still counts as "that event". */
const MATCH_WINDOW_HOURS = 18;

function sameTrack(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * What the desktop app saw each driver finish, for one event: their race
 * at the event's track, nearest the event date (or the most recent one if
 * the event has no date). A driver without the app, or who didn't race
 * there, has no entry -- that means "can't check", not "wrong".
 */
export async function getAppRecordsForEvent(event: LeagueEvent, userIds: number[]): Promise<Map<number, AppRaceRecord>> {
  const out = new Map<number, AppRaceRecord>();
  if (!userIds.length) return out;

  const conditions = [inArray(raceResults.userId, userIds)];
  if (event.eventDate) {
    const ms = MATCH_WINDOW_HOURS * 3600 * 1000;
    conditions.push(gte(raceResults.createdAt, new Date(event.eventDate.getTime() - ms)));
    conditions.push(lte(raceResults.createdAt, new Date(event.eventDate.getTime() + ms)));
  }
  const candidates = await db
    .select()
    .from(raceResults)
    .where(and(...conditions))
    .orderBy(desc(raceResults.createdAt));

  const target = event.eventDate?.getTime() ?? null;
  const best = new Map<number, (typeof candidates)[number]>();
  for (const c of candidates) {
    if (!sameTrack(c.track, event.track)) continue;
    const current = best.get(c.userId);
    if (!current) {
      best.set(c.userId, c);
    } else if (target !== null) {
      if (Math.abs(c.createdAt.getTime() - target) < Math.abs(current.createdAt.getTime() - target)) best.set(c.userId, c);
    }
    // No event date: candidates are newest-first, so the first one seen stays.
  }
  for (const [userId, c] of best) {
    out.set(userId, {
      place: c.place,
      classPlace: c.classPlace,
      finishStatus: c.finishStatus,
      laps: c.laps,
      fieldSize: c.fieldSize,
      car: c.car,
      at: c.createdAt,
      classification: c.classification,
    });
  }
  return out;
}

export type CheckVerdict = "match" | "differs" | "no-data";

/**
 * Does the entered result agree with what the app recorded? Overall place
 * or class place may match, since a league can score either; a DNF/DSQ
 * entry is compared with the sim's finish status instead.
 */
export function checkAgainstApp(
  entered: { position: number | null; status: string },
  app: AppRaceRecord | undefined,
): { verdict: CheckVerdict; note: string } {
  if (!app) return { verdict: "no-data", note: "No race recorded by the app" };
  const appStatus = app.finishStatus === 3 ? "dsq" : app.finishStatus === 2 ? "dnf" : "finished";
  const seen = `P${app.place}${app.classPlace && app.classPlace !== app.place ? ` (class P${app.classPlace})` : ""}`;
  if (entered.status === "finished") {
    if (entered.position !== null && (entered.position === app.place || entered.position === app.classPlace)) {
      return { verdict: "match", note: `App saw ${seen}` };
    }
    return { verdict: "differs", note: `App saw ${seen}` };
  }
  if (entered.status === "dns") return { verdict: "differs", note: `App recorded a race: ${seen}` };
  if (entered.status === appStatus) return { verdict: "match", note: `App saw ${appStatus.toUpperCase()}` };
  return { verdict: "differs", note: `App saw ${appStatus === "finished" ? seen : appStatus.toUpperCase()}` };
}

// ------------------------------------------------------------- calendar sync
//
// Push a league race into every registered driver who has connected Google
// Calendar. All of it is best-effort and fail-quiet: a revoked grant or a
// Google hiccup must never surface to the organiser saving the race.

/** How long a race blocks the calendar for when the app doesn't say otherwise. */
const RACE_SLOT_HOURS = 2;

function eventSummary(league: League, event: LeagueEvent): string {
  return `${league.name} — R${event.round} ${event.name}`;
}

function eventDescription(league: League, event: LeagueEvent): string {
  const when = event.eventDate ? `${event.eventDate.toISOString().slice(0, 16).replace("T", " ")} UTC` : "TBA";
  return [
    `${league.name}, round ${event.round}.`,
    `Track: ${event.track}`,
    `Starts: ${when}`,
    "",
    `${siteUrl()}/league/event/${event.id}`,
  ].join("\n");
}

/** Create/update one user's calendar event for one race, remembering its id. */
async function syncEventForUser(
  league: League,
  event: LeagueEvent,
  userId: number,
  refreshToken: string,
): Promise<void> {
  if (!event.eventDate) return;
  const existing = await db.query.leagueCalendarEvents.findFirst({
    where: and(eq(leagueCalendarEvents.userId, userId), eq(leagueCalendarEvents.eventId, event.id)),
  });
  const start = event.eventDate;
  const end = new Date(start.getTime() + RACE_SLOT_HOURS * 3600 * 1000);
  const gid = await upsertCalendarEvent(refreshToken, {
    summary: eventSummary(league, event),
    description: eventDescription(league, event),
    startUtc: start,
    endUtc: end,
    googleEventId: existing?.googleEventId ?? null,
  });
  if (!gid) return;
  if (existing) {
    if (existing.googleEventId !== gid) {
      await db.update(leagueCalendarEvents).set({ googleEventId: gid }).where(eq(leagueCalendarEvents.id, existing.id));
    }
  } else {
    await db
      .insert(leagueCalendarEvents)
      .values({ userId, eventId: event.id, googleEventId: gid })
      .onConflictDoNothing();
  }
}

/** The registered drivers of a league who have connected Google. */
async function connectedDrivers(leagueId: number) {
  return db
    .select({ userId: users.id, refreshToken: users.googleRefreshToken })
    .from(users)
    .innerJoin(leagueEntries, and(eq(leagueEntries.userId, users.id), eq(leagueEntries.leagueId, leagueId)))
    .where(isNotNull(users.googleRefreshToken));
}

/**
 * Bring every connected driver's calendar in line with a race that was just
 * created or edited. No date (or the date was cleared) means there's nothing
 * to show, so any event we'd added is removed instead.
 */
export async function syncLeagueEventToCalendars(league: League, event: LeagueEvent): Promise<void> {
  if (!calendarEnabled()) return;
  if (!event.eventDate) {
    await removeLeagueEventFromCalendars(event.id);
    return;
  }
  const drivers = await connectedDrivers(league.id);
  for (const d of drivers) {
    if (d.refreshToken) await syncEventForUser(league, event, d.userId, d.refreshToken).catch((e) => console.error("calendar sync:", e));
  }
}

/** Delete a race's calendar event from every driver who had one, then forget it. */
export async function removeLeagueEventFromCalendars(eventId: number): Promise<void> {
  if (!calendarEnabled()) return;
  const rows = await db.select().from(leagueCalendarEvents).where(eq(leagueCalendarEvents.eventId, eventId));
  for (const r of rows) {
    const u = await db.query.users.findFirst({ where: eq(users.id, r.userId) });
    if (u?.googleRefreshToken) await deleteCalendarEvent(u.googleRefreshToken, r.googleEventId).catch(() => {});
    await db.delete(leagueCalendarEvents).where(eq(leagueCalendarEvents.id, r.id));
  }
}

/**
 * A driver just connected Google: add every upcoming race of every league
 * they're registered for, so their calendar is caught up without them
 * waiting for the next edit.
 */
export async function backfillUserCalendars(userId: number): Promise<void> {
  if (!calendarEnabled()) return;
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user?.googleRefreshToken) return;
  const now = new Date();
  const rows = await db
    .select({ league: leagues, event: leagueEvents })
    .from(leagueEvents)
    .innerJoin(leagues, eq(leagues.id, leagueEvents.leagueId))
    .innerJoin(leagueEntries, and(eq(leagueEntries.leagueId, leagues.id), eq(leagueEntries.userId, userId)))
    .where(and(gte(leagueEvents.eventDate, now), isNotNull(leagueEvents.eventDate)));
  for (const { league, event } of rows) {
    await syncEventForUser(league, event, userId, user.googleRefreshToken).catch((e) => console.error("calendar backfill:", e));
  }
}
