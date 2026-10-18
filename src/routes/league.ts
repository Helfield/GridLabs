import { Hono } from "hono";
import type { Context } from "hono";
import { eq, and, inArray, max } from "drizzle-orm";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import { db } from "../db/client";
import { users, leagues, leagueEntries, leagueEvents, leagueResults } from "../db/schema";
import { getUserById } from "../db/queries";
import {
  isStaff,
  listLeagues,
  getLeague,
  getEntries,
  getEvents,
  getEvent,
  getEventResults,
  getStandings,
  isRegistered,
  saveEventResults,
  recalculateLeague,
  getAppRecordsForEvent,
  parsePointsTable,
  syncLeagueEventToCalendars,
  removeLeagueEventFromCalendars,
  backfillUserCalendars,
  RESULT_STATUSES,
  type ResultStatus,
} from "../db/league";
import { calendarEnabled, authorizeUrl, exchangeCode } from "../googleCalendar";
import { leagueIndexPage, leaguePage, eventPage, staffPage } from "../views/league-pages";

export const leagueRoutes = new Hono<{ Variables: AppVariables }>();

leagueRoutes.use("*", requireAuth);

type Ctx = Context<{ Variables: AppVariables }>;

async function currentUser(c: Ctx) {
  return getUserById(c.get("userId"));
}

/** The signed-in user if they're a coach or moderator, otherwise null. */
async function staffUser(c: Ctx) {
  const user = await currentUser(c);
  return user && isStaff(user.role) ? user : null;
}

async function coachUser(c: Ctx) {
  const user = await currentUser(c);
  return user && user.role === "coach" ? user : null;
}

function back(path: string, key: "msg" | "error", text: string): string {
  return `${path}?${key}=${encodeURIComponent(text)}`;
}

function intField(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function textField(v: unknown, maxLen: number): string {
  return typeof v === "string" ? v.trim().slice(0, maxLen) : "";
}

/** An optional SR/DR rating: a non-negative number rounded to 4 dp, or null if blank/invalid. */
function ratingField(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : null;
}

/** A datetime-local value ("2026-10-17T19:30"), read as UTC. Null if blank or invalid. */
function parseEventDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v.length === 16 ? `${v}:00Z` : `${v}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ------------------------------------------------------------------ lists

leagueRoutes.get("/", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  const all = await listLeagues();
  const mine = all.length
    ? await db
        .select({ leagueId: leagueEntries.leagueId })
        .from(leagueEntries)
        .where(and(eq(leagueEntries.userId, user.id), inArray(leagueEntries.leagueId, all.map((l) => l.id))))
    : [];
  return c.html(leagueIndexPage(user, all, new Set(mine.map((m) => m.leagueId)), c.req.query("msg")));
});

leagueRoutes.post("/new", async (c) => {
  const user = await coachUser(c);
  if (!user) return c.text("Not found.", 404);
  const body = await c.req.parseBody();
  const name = textField(body.name, 80);
  if (!name) return c.redirect(back("/league", "msg", "A league needs a name."));
  const [created] = await db
    .insert(leagues)
    .values({ name, description: textField(body.description, 1000) || null, createdBy: user.id })
    .returning({ id: leagues.id });
  return c.redirect(`/league/${created.id}`);
});

// ------------------------------------------------------------ staff (coach)
// Registered before "/:id" so "staff" isn't read as a league id.

leagueRoutes.get("/staff", async (c) => {
  const user = await coachUser(c);
  if (!user) return c.text("Not found.", 404);
  const members = await db
    .select({ id: users.id, name: users.name, discordUsername: users.discordUsername, role: users.role })
    .from(users)
    .orderBy(users.name);
  return c.html(staffPage(user, members, c.req.query("msg")));
});

for (const [action, role, from] of [
  ["promote", "moderator", "student"],
  ["demote", "student", "moderator"],
] as const) {
  leagueRoutes.post(`/staff/:userId/${action}`, async (c) => {
    const user = await coachUser(c);
    if (!user) return c.text("Not found.", 404);
    const id = Number(c.req.param("userId"));
    if (!Number.isInteger(id)) return c.redirect("/league/staff");
    // Only ever moves a student <-> moderator: a coach's role comes from
    // DISCORD_COACH_IDS and is not something to edit from here.
    await db.update(users).set({ role }).where(and(eq(users.id, id), eq(users.role, from)));
    return c.redirect(back("/league/staff", "msg", action === "promote" ? "Moderator added." : "Moderator removed."));
  });
}

// ------------------------------------------------------------------ events
// Also before "/:id".

leagueRoutes.get("/event/:eventId", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  const event = await getEvent(Number(c.req.param("eventId")));
  if (!event) return c.text("Event not found.", 404);
  const league = await getLeague(event.leagueId);
  if (!league) return c.text("League not found.", 404);
  const entries = await getEntries(league.id);
  const results = await getEventResults(event.id);
  // The app cross-check is for the organisers only -- it names drivers who
  // might simply not have the app, so it isn't shown to everyone.
  const appRecords = isStaff(user.role) ? await getAppRecordsForEvent(event, entries.map((e) => e.userId)) : new Map();
  return c.html(
    eventPage(user, { league, event, entries, results, appRecords, msg: c.req.query("msg"), error: c.req.query("error") }),
  );
});

leagueRoutes.post("/event/:eventId/results", async (c) => {
  const user = await staffUser(c);
  if (!user) return c.text("Not found.", 404);
  const event = await getEvent(Number(c.req.param("eventId")));
  if (!event) return c.text("Event not found.", 404);
  const league = await getLeague(event.leagueId);
  if (!league) return c.text("League not found.", 404);

  const body = await c.req.parseBody();
  const entries = await getEntries(league.id);
  const rows: Parameters<typeof saveEventResults>[3] = [];
  for (const e of entries) {
    const status = body[`status_${e.userId}`];
    if (typeof status !== "string" || !RESULT_STATUSES.includes(status as ResultStatus)) continue; // blank = not in this race
    const pos = Number(body[`pos_${e.userId}`]);
    rows.push({
      userId: e.userId,
      status: status as ResultStatus,
      position: Number.isInteger(pos) && pos > 0 ? pos : null,
      pole: body[`pole_${e.userId}`] === "1",
      fastestLap: body[`fl_${e.userId}`] === "1",
      adjustment: intField(body[`adj_${e.userId}`], 0, -50, 50),
    });
  }

  const error = await saveEventResults(league, event.id, user.id, rows);
  const path = `/league/event/${event.id}`;
  return c.redirect(error ? back(path, "error", error) : back(path, "msg", "Results saved."));
});

leagueRoutes.post("/event/:eventId/edit", async (c) => {
  const user = await coachUser(c);
  if (!user) return c.text("Not found.", 404);
  const id = Number(c.req.param("eventId"));
  const event = await getEvent(id);
  if (!event) return c.text("Event not found.", 404);
  const body = await c.req.parseBody();
  const name = textField(body.name, 80);
  const track = textField(body.track, 120);
  if (!name || !track) return c.redirect(back(`/league/event/${id}`, "error", "Name and track are required."));
  await db
    .update(leagueEvents)
    .set({ name, track, round: intField(body.round, event.round, 1, 99), eventDate: parseEventDate(body.eventDate) })
    .where(eq(leagueEvents.id, id));
  const updated = await getEvent(id);
  const league = await getLeague(event.leagueId);
  if (updated && league) void syncLeagueEventToCalendars(league, updated).catch((e) => console.error("calendar sync:", e));
  return c.redirect(back(`/league/event/${id}`, "msg", "Event updated."));
});

leagueRoutes.post("/event/:eventId/delete", async (c) => {
  const user = await coachUser(c);
  if (!user) return c.text("Not found.", 404);
  const id = Number(c.req.param("eventId"));
  const event = await getEvent(id);
  if (!event) return c.redirect("/league");
  // Take it off every connected driver's calendar first -- that also clears
  // the league_calendar_events rows, which reference this event.
  await removeLeagueEventFromCalendars(id).catch((e) => console.error("calendar remove:", e));
  await db.delete(leagueResults).where(eq(leagueResults.eventId, id));
  await db.delete(leagueEvents).where(eq(leagueEvents.id, id));
  return c.redirect(back(`/league/${event.leagueId}`, "msg", "Event deleted."));
});

// ----------------------------------------------------------- calendar connect
// Registered before "/:id" so "calendar" isn't read as a league id.

leagueRoutes.get("/calendar/connect", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  if (!calendarEnabled()) return c.redirect(back("/league", "error", "Google Calendar isn't set up on this site yet."));
  // state carries the user id so the callback can confirm the round-trip
  // belongs to whoever is signed in (the session cookie is still present).
  const state = Buffer.from(JSON.stringify({ u: user.id, n: crypto.randomUUID() })).toString("base64url");
  return c.redirect(authorizeUrl(state));
});

leagueRoutes.get("/calendar/callback", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  if (c.req.query("error")) return c.redirect(back("/league", "error", "Google Calendar connection was cancelled."));
  const code = c.req.query("code");
  const state = c.req.query("state");
  let stateUser: number | undefined;
  try {
    stateUser = JSON.parse(Buffer.from(state ?? "", "base64url").toString()).u;
  } catch {
    stateUser = undefined;
  }
  if (!code || stateUser !== user.id)
    return c.redirect(back("/league", "error", "That calendar request was incomplete. Please try again."));
  const grant = await exchangeCode(code);
  if (!grant) return c.redirect(back("/league", "error", "Couldn't complete the Google Calendar connection."));
  await db
    .update(users)
    .set({ googleEmail: grant.email, googleRefreshToken: grant.refreshToken })
    .where(eq(users.id, user.id));
  // Catch the calendar up with races already scheduled for leagues they're in.
  await backfillUserCalendars(user.id).catch((e) => console.error("calendar backfill:", e));
  return c.redirect(back("/league", "msg", "Google Calendar connected — upcoming races are on your calendar."));
});

leagueRoutes.post("/calendar/disconnect", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  await db
    .update(users)
    .set({ googleEmail: null, googleRefreshToken: null })
    .where(eq(users.id, user.id));
  return c.redirect(back("/league", "msg", "Google Calendar disconnected. Races already added stay in your calendar."));
});

// ----------------------------------------------------------------- league

leagueRoutes.get("/:id", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  const league = await getLeague(Number(c.req.param("id")));
  if (!league) return c.text("League not found.", 404);
  const [entries, events, registered] = await Promise.all([
    getEntries(league.id),
    getEvents(league.id),
    isRegistered(league.id, user.id),
  ]);
  const standings = await getStandings(league.id, events);
  return c.html(
    leaguePage(user, {
      league,
      entries,
      events,
      standings,
      registered,
      calendarOn: calendarEnabled(),
      calendarConnected: Boolean(user.googleRefreshToken),
      calendarEmail: user.googleEmail,
      msg: c.req.query("msg"),
      error: c.req.query("error"),
    }),
  );
});

leagueRoutes.post("/:id/register", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  const id = Number(c.req.param("id"));
  const league = await getLeague(id);
  if (!league) return c.text("League not found.", 404);
  if (!league.registrationOpen) return c.redirect(back(`/league/${id}`, "error", "Registration is closed."));
  const body = await c.req.parseBody();
  await db
    .insert(leagueEntries)
    .values({
      leagueId: id,
      userId: user.id,
      team: textField(body.team, 60) || null,
      srRating: ratingField(body.srRating),
      drRating: ratingField(body.drRating),
    })
    .onConflictDoNothing();
  return c.redirect(back(`/league/${id}`, "msg", "You're registered."));
});

leagueRoutes.post("/:id/withdraw", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  const id = Number(c.req.param("id"));
  await db.delete(leagueEntries).where(and(eq(leagueEntries.leagueId, id), eq(leagueEntries.userId, user.id)));
  return c.redirect(back(`/league/${id}`, "msg", "You've withdrawn."));
});

leagueRoutes.post("/:id/events", async (c) => {
  const user = await staffUser(c);
  if (!user) return c.text("Not found.", 404);
  const id = Number(c.req.param("id"));
  const league = await getLeague(id);
  if (!league) return c.text("League not found.", 404);
  const body = await c.req.parseBody();
  const name = textField(body.name, 80);
  const track = textField(body.track, 120);
  if (!name || !track) return c.redirect(back(`/league/${id}`, "error", "An event needs a name and a track."));
  const [{ top }] = await db.select({ top: max(leagueEvents.round) }).from(leagueEvents).where(eq(leagueEvents.leagueId, id));
  const [created] = await db
    .insert(leagueEvents)
    .values({
      leagueId: id,
      round: intField(body.round, (top ?? 0) + 1, 1, 99),
      name,
      track,
      eventDate: parseEventDate(body.eventDate),
    })
    .returning({ id: leagueEvents.id });
  const full = await getEvent(created.id);
  if (full) void syncLeagueEventToCalendars(league, full).catch((e) => console.error("calendar sync:", e));
  return c.redirect(`/league/event/${created.id}`);
});

leagueRoutes.post("/:id/add-driver", async (c) => {
  const user = await staffUser(c);
  if (!user) return c.text("Not found.", 404);
  const id = Number(c.req.param("id"));
  const body = await c.req.parseBody();
  const username = textField(body.username, 64).replace(/^@/, "");
  const member = username
    ? await db.query.users.findFirst({ where: eq(users.discordUsername, username), columns: { id: true, name: true } })
    : undefined;
  if (!member) return c.redirect(back(`/league/${id}`, "error", `No member with the Discord username "${username}" has signed in yet.`));
  await db.insert(leagueEntries).values({ leagueId: id, userId: member.id }).onConflictDoNothing();
  return c.redirect(back(`/league/${id}`, "msg", `${member.name} added.`));
});

leagueRoutes.post("/:id/remove/:userId", async (c) => {
  const user = await staffUser(c);
  if (!user) return c.text("Not found.", 404);
  const id = Number(c.req.param("id"));
  await db
    .delete(leagueEntries)
    .where(and(eq(leagueEntries.leagueId, id), eq(leagueEntries.userId, Number(c.req.param("userId")))));
  return c.redirect(back(`/league/${id}`, "msg", "Driver removed."));
});

leagueRoutes.post("/:id/settings", async (c) => {
  const user = await coachUser(c);
  if (!user) return c.text("Not found.", 404);
  const id = Number(c.req.param("id"));
  const league = await getLeague(id);
  if (!league) return c.text("League not found.", 404);
  const body = await c.req.parseBody();
  const name = textField(body.name, 80);
  const pointsTable = parsePointsTable(textField(body.pointsTable, 200));
  if (!name) return c.redirect(back(`/league/${id}`, "error", "A league needs a name."));
  if (pointsTable.length === 0) return c.redirect(back(`/league/${id}`, "error", "Enter the points for at least 1st place, e.g. 25,18,15."));

  await db
    .update(leagues)
    .set({
      name,
      description: textField(body.description, 1000) || null,
      pointsTable: pointsTable.join(","),
      fastestLapBonus: intField(body.fastestLapBonus, 0, 0, 20),
      poleBonus: intField(body.poleBonus, 0, 0, 20),
      participationPoints: intField(body.participationPoints, 0, 0, 20),
      registrationOpen: body.registrationOpen === "1",
    })
    .where(eq(leagues.id, id));
  // The rules may have changed, so every stored result is re-scored.
  const updated = await getLeague(id);
  if (updated) await recalculateLeague(updated);
  return c.redirect(back(`/league/${id}`, "msg", "Settings saved and results re-scored."));
});
