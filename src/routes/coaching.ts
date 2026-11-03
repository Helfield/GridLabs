/**
 * coaching.ts
 *
 * The paid-coaching routes.
 *
 * Everything here asks the entitlements table the same question: does this
 * account hold this package. Nothing reads a payment provider and nothing reads
 * users.role for access, so connecting Whop later means writing those rows from
 * its webhook and changing none of this.
 */

import { Hono, type Context } from "hono";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import { getUserById } from "../db/queries";
import { getDeclaredBands, getEvents, isStaff, listLeagues } from "../db/league";
import {
  addCoachingNote,
  deleteCoachingNote,
  getCoachingNote,
  getCoachingProfile,
  getEntitlementsForUser,
  grantProduct,
  hasProduct,
  listAllEntitlements,
  listCoachingNotes,
  listCoachingProducts,
  listCoachingStudents,
  listGrantCandidates,
  revokeProduct,
  saveCoachingProfile,
  type CoachingProfile,
} from "../db/coaching";
import { LIVE_EVENTS, ONE_TO_ONE, noteRemovableBy, validateIntake, validateNote } from "../coachingRules";
import {
  coachingAdminPage,
  coachingHubPage,
  coachingIntakePage,
  coachingProfilePage,
  coachingStudentPage,
  coachingStudentsPage,
  liveSchedulePage,
  type IntakeValues,
} from "../views/coaching";

export const coachingRoutes = new Hono<{ Variables: AppVariables }>();

coachingRoutes.use("*", requireAuth);

type Ctx = Context<{ Variables: AppVariables }>;

async function currentUser(c: Ctx) {
  return getUserById(c.get("userId"));
}

/** The signed-in user if they're a coach or moderator, otherwise null. */
async function staffUser(c: Ctx) {
  const user = await currentUser(c);
  return user && isStaff(user.role) ? user : null;
}

function back(path: string, key: "msg" | "error", text: string): string {
  return `${path}?${key}=${encodeURIComponent(text)}`;
}

function readNotice(c: Ctx) {
  const msg = c.req.query("msg");
  const error = c.req.query("error");
  return error ? { kind: "error" as const, text: error } : msg ? { kind: "ok" as const, text: msg } : null;
}

coachingRoutes.get("/", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  const [products, held] = await Promise.all([listCoachingProducts(), getEntitlementsForUser(user.id)]);
  return c.html(coachingHubPage(user, products, held, { notice: readNotice(c) }));
});

/** Gated on the Live events package: a member of the club can see the season, this is what they paid for. */
coachingRoutes.get("/live", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  if (!(await hasProduct(user.id, LIVE_EVENTS))) {
    return c.redirect(back("/coaching", "error", "The Live events package isn't on your account yet."));
  }
  return c.html(liveSchedulePage(user, await liveRounds(new Date())));
});

/**
 * The club's nights on track together, soonest first.
 *
 * A round with no date set is still to come as far as anyone knows, so it is kept
 * and shown after the dated rounds rather than dropped: dropping undated rounds
 * would leave this page empty for a season whose calendar hasn't been dated yet,
 * which is the usual state of one.
 */
async function liveRounds(now: Date) {
  const leagues = await listLeagues();
  const rounds: Array<{ league: string; round: number; track: string; eventDate: Date | null }> = [];
  for (const league of leagues) {
    for (const event of await getEvents(league.id)) {
      if (event.eventDate && event.eventDate.getTime() < now.getTime()) continue;
      rounds.push({ league: league.name, round: event.round, track: event.track, eventDate: event.eventDate });
    }
  }
  return rounds.sort((a, b) => {
    const av = a.eventDate ? a.eventDate.getTime() : Number.POSITIVE_INFINITY;
    const bv = b.eventDate ? b.eventDate.getTime() : Number.POSITIVE_INFINITY;
    if (av !== bv) return av < bv ? -1 : 1;
    return a.round - b.round;
  });
}

// ------------------------------------------------------------------ portal

/**
 * The gate every portal page shares: the 1-on-1 package.
 *
 * Same shape as the live schedule's gate, and for the same reason -- the question
 * is always "does this account hold this package", never "what is this account
 * called".
 *
 * The account lookup is checked separately from the package, in each handler. A
 * session for an account that has been deleted is a sign-in problem, and being
 * told to pay the club for it would send them to the wrong place.
 */
const refused = (c: Ctx) =>
  c.redirect(back("/coaching", "error", "The 1-on-1 package isn't on your account yet. Once the club has your payment, a coach puts it on."));

/**
 * What the form holds when it isn't holding a driver's own submission back.
 *
 * Prefilled from their account and their league registration so the only questions
 * they have to think about are the ones a coach can't already look up. The
 * address the Discord sign-in invents (`<id>@discord.unknown`) isn't an email and
 * is left blank rather than typed into a field that would send a booking nowhere.
 */
async function formValues(
  user: { id: number; name: string; email: string },
  profile: CoachingProfile | null,
): Promise<IntakeValues> {
  const bands = profile ? { srBand: profile.srBand, drBand: profile.drBand } : await getDeclaredBands(user.id);
  return {
    name: profile?.name ?? user.name,
    email: profile?.email ?? (user.email.endsWith("@discord.unknown") ? "" : user.email),
    srBand: bands.srBand,
    drBand: bands.drBand,
    experience: profile?.experience ?? null,
    classes: profile?.classes ?? [],
    goal: profile?.goal ?? "",
    setupLink: profile?.setupLink ?? null,
    video: profile?.video ?? "",
  };
}

/** Their own answers, as typed, put back into the form after one of them was refused. */
function echoValues(body: Record<string, unknown>): IntakeValues {
  const text = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : v === undefined || v === "" ? [] : [text(v)]);
  return {
    name: text(body.name),
    email: text(body.email),
    srBand: text(body.srBand) || null,
    drBand: text(body.drBand) || null,
    experience: text(body.experience) || null,
    classes: list(body.classes),
    goal: text(body.goal),
    setupLink: text(body.setupLink) || null,
    video: text(body.video),
  };
}

/**
 * The portal itself: the intake form until it's filled in, the profile after.
 *
 * One address for both because that's how it reads to the member: they paid, they
 * land here, and the thing that's missing is their own details rather than a page.
 */
coachingRoutes.get("/portal", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  if (!(await hasProduct(user.id, ONE_TO_ONE))) return refused(c);
  const profile = await getCoachingProfile(user.id);
  if (profile) {
    return c.html(coachingProfilePage(user, profile, { notice: readNotice(c), notes: await listCoachingNotes(user.id) }));
  }
  return c.html(
    coachingIntakePage(user, {
      values: await formValues(user, null),
      editing: false,
      notice: readNotice(c),
    }),
  );
});

/** The same form with a saved profile in it, for when something has changed. */
coachingRoutes.get("/portal/edit", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  if (!(await hasProduct(user.id, ONE_TO_ONE))) return refused(c);
  const profile = await getCoachingProfile(user.id);
  if (!profile) return c.redirect("/coaching/portal");
  return c.html(
    coachingIntakePage(user, {
      values: await formValues(user, profile),
      editing: true,
      notice: readNotice(c),
    }),
  );
});

/**
 * Save the intake.
 *
 * A refused submission comes back as the form with their own words still in it and
 * the reason beside each field, rather than a redirect that loses everything they
 * typed. First save creates the row; every one after it updates the same row, so
 * what a coach reads is whatever the driver sent last.
 */
coachingRoutes.post("/portal", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.redirect("/login");
  if (!(await hasProduct(user.id, ONE_TO_ONE))) return refused(c);
  const profile = await getCoachingProfile(user.id);
  const body = await c.req.parseBody({ all: true });
  const { intake, errors } = validateIntake({
    name: body.name,
    email: body.email,
    srBand: body.srBand,
    drBand: body.drBand,
    experience: body.experience,
    classes: body.classes,
    goal: body.goal,
    setupLink: body.setupLink,
    video: body.video,
  });
  if (!intake) {
    return c.html(
      coachingIntakePage(user, {
        values: echoValues(body),
        errors,
        editing: !!profile,
        notice: { kind: "error", text: "Nothing was saved yet. The fields marked below need another look." },
      }),
      422,
    );
  }
  await saveCoachingProfile(user.id, intake);
  return c.redirect(back("/coaching/portal", "msg", profile ? "Your profile is updated." : "Thanks, that's everything your coach asked for."));
});

coachingRoutes.get("/admin", async (c) => {
  const staff = await staffUser(c);
  if (!staff) return c.redirect("/coaching");
  const [products, rows, candidates] = await Promise.all([
    listCoachingProducts(),
    listAllEntitlements(),
    listGrantCandidates(),
  ]);
  return c.html(coachingAdminPage(staff, products, rows, candidates, { notice: readNotice(c) }));
});

/**
 * Add a package to someone by hand.
 *
 * This is what a member gets while the checkout doesn't exist: they pay the club
 * the old way and a coach writes the row. It is also the escape hatch that stays
 * after the gateway arrives, for a gifted seat or a payment the webhook missed.
 */
coachingRoutes.post("/admin/grant", async (c) => {
  const staff = await staffUser(c);
  if (!staff) return c.redirect("/coaching");
  const body = await c.req.parseBody();

  const userId = Number(body.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return c.redirect(back("/coaching/admin", "error", "Choose a driver."));
  }
  const slug = typeof body.slug === "string" ? body.slug : "";
  // Checked against the products table rather than a list in here, so adding a
  // package is a row and not a route edit.
  const product = (await listCoachingProducts()).find((p) => p.slug === slug);
  if (!product) return c.redirect(back("/coaching/admin", "error", "That package doesn't exist."));

  const raw = typeof body.expires === "string" ? body.expires.trim() : "";
  let expiresAt: Date | null = null;
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return c.redirect(back("/coaching/admin", "error", "That end date isn't a date."));
    }
    // To the end of the day, not its start: a holding set to run to the 30th is
    // still good on the 30th.
    expiresAt = new Date(`${raw}T23:59:59Z`);
    if (Number.isNaN(expiresAt.getTime())) {
      return c.redirect(back("/coaching/admin", "error", "That end date isn't a date."));
    }
  }

  const target = await getUserById(userId);
  if (!target) return c.redirect(back("/coaching/admin", "error", "That driver has no account here."));

  const result = await grantProduct(userId, slug, { grantedBy: staff.id, expiresAt });
  if (!result) {
    return c.redirect(back("/coaching/admin", "error", "The package table has no such slug."));
  }
  return c.redirect(
    back("/coaching/admin", "msg", `${target.name} now has ${product.name}.${expiresAt ? ` It runs to ${raw}.` : ""}`),
  );
});

coachingRoutes.post("/admin/revoke", async (c) => {
  const staff = await staffUser(c);
  if (!staff) return c.redirect("/coaching");
  const body = await c.req.parseBody();
  const userId = Number(body.userId);
  const slug = typeof body.slug === "string" ? body.slug : "";
  if (!Number.isInteger(userId) || userId <= 0) return c.redirect(back("/coaching/admin", "error", "Choose a driver."));
  const removed = await revokeProduct(userId, slug);
  const target = await getUserById(userId);
  return c.redirect(
    back(
      "/coaching/admin",
      removed ? "msg" : "error",
      removed
        ? `${target?.name ?? "That driver"} no longer has that package.`
        : "They didn't hold it, so nothing changed.",
    ),
  );
});

// ---------------------------------------------------------------- staff: notes

/**
 * The driver a notes route is about, or null.
 *
 * Two things have to hold: the account exists, and it holds the 1-on-1 package.
 * The second is what stops a hand-written form from writing notes onto an account
 * that never bought coaching -- the list a coach clicks from only ever shows
 * holders, so this is the same rule applied again where nobody is looking.
 */
async function studentOf(id: string) {
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const student = await getUserById(userId);
  if (!student || !(await hasProduct(student.id, ONE_TO_ONE))) return null;
  return student;
}

/** Who holds the package, what of their profile exists, and how much is written on it. */
coachingRoutes.get("/students", async (c) => {
  const staff = await staffUser(c);
  if (!staff) return c.redirect("/coaching");
  return c.html(coachingStudentsPage(staff, await listCoachingStudents(), { notice: readNotice(c) }));
});

/** One driver's page: their intake, their notes, and the box that adds the next one. */
coachingRoutes.get("/students/:id", async (c) => {
  const staff = await staffUser(c);
  if (!staff) return c.redirect("/coaching");
  const student = await studentOf(c.req.param("id"));
  if (!student) return c.redirect(back("/coaching/students", "error", "That driver isn't on the student list."));
  const [profile, notes] = await Promise.all([getCoachingProfile(student.id), listCoachingNotes(student.id)]);
  return c.html(coachingStudentPage(staff, student, profile, notes, { notice: readNotice(c) }));
});

/**
 * Write a note.
 *
 * A refused one comes back as the same page with the coach's own words still in the
 * box: they've just described a session, and losing that to a length limit is a
 * worse outcome than the limit itself.
 */
coachingRoutes.post("/students/:id/notes", async (c) => {
  const staff = await staffUser(c);
  if (!staff) return c.redirect("/coaching");
  const student = await studentOf(c.req.param("id"));
  if (!student) return c.redirect(back("/coaching/students", "error", "That driver isn't on the student list."));
  const body = await c.req.parseBody();
  const raw = typeof body.body === "string" ? body.body : "";
  const [profile, notes] = await Promise.all([getCoachingProfile(student.id), listCoachingNotes(student.id)]);
  const { note, error } = validateNote(raw);
  if (!note) {
    return c.html(
      coachingStudentPage(staff, student, profile, notes, {
        notice: { kind: "error", text: "Nothing was saved." },
        error,
        draft: raw,
      }),
      422,
    );
  }
  await addCoachingNote(student.id, staff.id, note);
  return c.redirect(back(`/coaching/students/${student.id}`, "msg", "Saved. They can read it now."));
});

/**
 * Take a note away.
 *
 * Where it goes back to is read off the note rather than the form, so a hand-built
 * request can't use this route to land somewhere else carrying a message.
 */
coachingRoutes.post("/notes/remove", async (c) => {
  const staff = await staffUser(c);
  if (!staff) return c.redirect("/coaching");
  const body = await c.req.parseBody();
  const noteId = Number(body.noteId);
  const note = Number.isInteger(noteId) && noteId > 0 ? await getCoachingNote(noteId) : null;
  if (!note) return c.redirect(back("/coaching/students", "error", "That note is already gone."));
  if (!noteRemovableBy(note, staff)) {
    return c.redirect(back(`/coaching/students/${note.userId}`, "error", "Only its writer can remove it, or a moderator."));
  }
  await deleteCoachingNote(noteId);
  return c.redirect(back(`/coaching/students/${note.userId}`, "msg", "Note removed."));
});
