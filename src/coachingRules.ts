/**
 * coachingRules.ts
 *
 * The paid-coaching decisions. Reading and writing the rows is
 * src/db/coaching.ts; anything that decides access, validates an intake answer or
 * a coach's note, or matches a member to a coach lives here, holding no database,
 * so every case in it can be tested directly. The same split as
 * src/leagueRules.ts.
 */

import { LICENCE_BANDS } from "./leagueRules";
import { SCORING_CLASSES } from "./classes";

/** The two packages on offer, as their product slugs. */
export const ONE_TO_ONE = "one_to_one";
export const LIVE_EVENTS = "live_events";

/**
 * The classes the intake offers, which is what a coach can be asked to teach.
 *
 * GT4 is scored by the league tables (src/classes.ts keeps it because stored
 * results name it) but Le Mans Ultimate has no GT4 class, so offering one here
 * would invite an answer no coach can act on.
 */
export const COACHING_CLASSES = SCORING_CLASSES.filter((c) => c !== "GT4");

/**
 * Does this entitlement count right now.
 *
 * A null expiry never runs out, which is what a hand grant is: a coach adding
 * access has no billing period behind it to inherit an end date from. A paid one
 * carries the end of its current period so an unpaid renewal takes access away
 * without anyone having to notice.
 */
export function entitlementCounts(row: { expiresAt: Date | null }, now: Date = new Date()): boolean {
  return row.expiresAt === null || row.expiresAt.getTime() > now.getTime();
}

/**
 * An http(s) link someone pasted, or null if it isn't one.
 *
 * The intake form takes links rather than files (their setup photo is hosted on
 * an image site, their race on YouTube), so this is the whole of the check:
 * protocol and a host. Storing anything else would be a page that renders a dead
 * image tag or a link a coach can't open.
 */
export function linkField(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (!raw || raw.length > 400) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;
  return url.toString();
}

/**
 * Is this a YouTube video someone can actually watch.
 *
 * The channel link is the coach's main input, so a link to a playlist, a channel
 * or the homepage would be accepted by linkField and waste the session. A watch
 * URL needs an id parameter; Shorts and the youtu.be form are the same video, so
 * all three are read and the canonical watch URL is what gets stored.
 */
export function youtubeLink(v: unknown): string | null {
  const link = linkField(v);
  if (!link) return null;
  const url = new URL(link);
  const host = url.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return isVideoId(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com") return null;
  const id = url.searchParams.get("v");
  if (id && isVideoId(id)) return `https://www.youtube.com/watch?v=${id}`;
  const shorts = /^\/shorts\/([\w-]{11})(?:\/|$)/.exec(url.pathname);
  return shorts ? `https://www.youtube.com/watch?v=${shorts[1]}` : null;
}

/** YouTube ids are eleven characters from this set; anything shorter is a truncated paste. */
function isVideoId(id: string | null | undefined): id is string {
  return !!id && /^[\w-]{11}$/.test(id);
}

// ---------------------------------------------------------------- intake

/**
 * How long someone has been sim racing, as the intake form offers it.
 *
 * Bands rather than a number of years because "since iRacing 2018" and "about a
 * year now" are the same answer to a coach, and a free-text box invites a
 * sentence into a column. Ordered lowest to highest so a coach can read it
 * straight down.
 */
export const SIM_EXPERIENCE = ["Under a year", "1 to 2 years", "3 to 5 years", "Over 5 years"];

/** Raw form values, before any of them is believed. */
export type IntakeForm = {
  name: unknown;
  email: unknown;
  srBand: unknown;
  drBand: unknown;
  experience: unknown;
  classes: unknown;
  goal: unknown;
  setupLink: unknown;
  video: unknown;
};

/** What the intake form is allowed to write to the database. */
export type Intake = {
  name: string;
  email: string;
  srBand: string;
  drBand: string;
  experience: string;
  classes: string[];
  goal: string;
  setupLink: string | null;
  video: string;
};

export const GOAL_MIN = 20;
export const GOAL_MAX = 600;
/** Enough to plan a season around, and a hard ceiling on how long the form can be. */
export const MAX_CLASSES = 6;

/**
 * Check an intake submission and say what's wrong, field by field.
 *
 * Every answer is either one of the choices the form offers or a link that
 * resolves, so a coach reading a profile never sees a class the game doesn't have
 * or opens a video that doesn't exist. The two links the coach needs most are the
 * ones that are required: the lap recording, because it is the whole of the
 * pre-session read on someone, and the goal, because without it there's nothing
 * to aim the sessions at. A setup photo has a habit of not being hosted anywhere
 * yet, so it's allowed to stay blank and be filled in later.
 *
 * There is no track question. The recording names the track they most want to
 * improve at, which is the one the session is about, and a list of circuits they
 * hope to get better at tells a coach nothing a lap time wouldn't.
 */
export function validateIntake(form: IntakeForm): { intake: Intake | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const name = one(form.name, 80);
  if (!name) errors.name = "Give the name your coach should call you.";

  const emailRaw = one(form.email, 120).toLowerCase();
  if (!emailRaw) errors.email = "An email address is how your coach sends anything you book.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailRaw)) errors.email = "That doesn't look like an email address.";

  const srBand = one(form.srBand, 40);
  if (!LICENCE_BANDS.includes(srBand)) errors.srBand = "Pick your Safety Rating band.";
  const drBand = one(form.drBand, 40);
  if (!LICENCE_BANDS.includes(drBand)) errors.drBand = "Pick your Driver Rating band.";

  const experience = one(form.experience, 40);
  if (!SIM_EXPERIENCE.includes(experience)) errors.experience = "Say how long you've been sim racing.";

  const classes = many(form.classes).filter((cl) => COACHING_CLASSES.includes(cl));
  if (classes.length === 0) errors.classes = "Pick at least one class you want work on.";

  const goalRaw = typeof form.goal === "string" ? form.goal.trim() : "";
  // Refused rather than cut: a goal trimmed by the server is a sentence the
  // driver wrote that their coach never sees.
  const goal = goalRaw.slice(0, GOAL_MAX);
  if (goalRaw.length > GOAL_MAX) errors.goal = `That's over ${GOAL_MAX} characters. Shorten it.`;
  else if (goal.length < GOAL_MIN) errors.goal = `Say what you want out of this, in at least ${GOAL_MIN} characters.`;

  const setupRaw = typeof form.setupLink === "string" ? form.setupLink.trim() : "";
  const setupLink = linkField(form.setupLink);
  if (setupRaw && !setupLink) errors.setupLink = "That isn't a link. Paste the address of the image, starting with https.";

  const video = youtubeLink(form.video);
  if (!video) errors.video = "Paste a YouTube link to your fastest lap at that track.";

  // Writing the row and finding a problem with it are the same branch, so a value
  // that failed above can never reach the database.
  if (video && Object.keys(errors).length === 0) {
    return {
      intake: {
        name: name.slice(0, 80),
        email: emailRaw,
        srBand,
        drBand,
        experience,
        classes: classes.slice(0, MAX_CLASSES),
        goal,
        setupLink,
        video,
      },
      errors,
    };
  }

  return { intake: null, errors };
}

/** A single value from the form, trimmed, with the length cap applied before anything reads it. */
function one(v: unknown, maxLen: number): string {
  return typeof v === "string" ? v.trim().slice(0, maxLen) : "";
}

/** Repeated inputs under the same name (the checkbox groups) as a list of non-blank strings. */
function many(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];
  return unique(list.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean));
}

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------- notes

/**
 * How much a coach's note has to be.
 *
 * The floor is low because the useful one is written at the side of a session, in
 * a hurry: "braking too early into the last corner" is worth keeping. The ceiling
 * is a whole session's notes in one go, and a coach who passes it is better off
 * writing a second note with its own date than one unbroken page.
 */
export const NOTE_MIN = 4;
export const NOTE_MAX = 2000;

/**
 * Check a note before it's stored.
 *
 * The blank form and the form that only says "." are refused rather than stored:
 * a note that says nothing still shows up in the list, and the coach who reads
 * their own thread next week can't tell it apart from a session they forgot.
 */
export function validateNote(v: unknown): { note: string | null; error: string | null } {
  const body = typeof v === "string" ? v.trim() : "";
  if (body.length < NOTE_MIN) return { note: null, error: `Write what you want them to remember, at least ${NOTE_MIN} characters.` };
  if (body.length > NOTE_MAX) return { note: null, error: `That's over ${NOTE_MAX} characters. Save it as two notes.` };
  return { note: body, error: null };
}

/**
 * May this account remove a note.
 *
 * Whoever wrote it, and a moderator. Not another coach: a note is one person's
 * read of a session, and the club still needs somebody who can take one down after
 * its writer has stopped coaching.
 */
export function noteRemovableBy(note: { authorId: number }, viewer: { id: number; role: string }): boolean {
  return note.authorId === viewer.id || viewer.role === "moderator";
}
