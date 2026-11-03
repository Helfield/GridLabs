/**
 * coaching.ts
 *
 * The paid-coaching rows: which packages exist, who holds them, what the holder
 * filled in, and what their coach has written about them.
 *
 * This is the only place access is decided, and it decides it from the
 * entitlements table alone. That is what keeps the payment gateway out of the
 * rest of the site: when Whop is connected it writes these same rows from its
 * webhook, and every gate on the site carries on asking the same question of the
 * same table without knowing anything happened.
 *
 * The rules themselves -- whether an entitlement still counts, whether a pasted
 * link is usable, whether a note is worth storing -- are in src/coachingRules.ts,
 * which holds no database.
 */

import { db } from "./client";
import { coachingEntitlements, coachingNotes, coachingProducts, coachingProfiles, users } from "./schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { entitlementCounts, ONE_TO_ONE, type Intake } from "../coachingRules";

export type CoachingProduct = typeof coachingProducts.$inferSelect;
export type EntitlementSource = "manual" | "whop_role" | "whop_webhook";

export async function listCoachingProducts(): Promise<CoachingProduct[]> {
  return db.select().from(coachingProducts).orderBy(asc(coachingProducts.id));
}

/** Everything one member holds, current or lapsed, with the package's own wording. */
export async function getEntitlementsForUser(userId: number) {
  return db
    .select({
      id: coachingEntitlements.id,
      slug: coachingProducts.slug,
      name: coachingProducts.name,
      blurb: coachingProducts.blurb,
      unlocks: coachingProducts.unlocks,
      source: coachingEntitlements.source,
      externalId: coachingEntitlements.externalId,
      expiresAt: coachingEntitlements.expiresAt,
      createdAt: coachingEntitlements.createdAt,
    })
    .from(coachingEntitlements)
    .innerJoin(coachingProducts, eq(coachingEntitlements.productId, coachingProducts.id))
    .where(eq(coachingEntitlements.userId, userId))
    .orderBy(asc(coachingProducts.id));
}

/** The slugs this member may open portals with right now. */
export async function getActiveSlugs(userId: number, now: Date = new Date()): Promise<Set<string>> {
  const rows = await getEntitlementsForUser(userId);
  return new Set(rows.filter((r) => entitlementCounts(r, now)).map((r) => r.slug));
}

/**
 * The one question every gated page asks.
 *
 * Reads through the entitlement rather than a role: a coach who buys the 1-on-1
 * package is a member of it, and a student on the free tier is not, whatever
 * either of them is called in users.role.
 */
export async function hasProduct(userId: number, slug: string, now: Date = new Date()): Promise<boolean> {
  return (await getActiveSlugs(userId, now)).has(slug);
}

/**
 * Give a member a package, or renew one they already hold.
 *
 * Updating rather than erroring on a repeat matters: the same person is granted
 * twice by whoever is at the keyboard, and a Whop webhook replays. The row stays
 * one, with the new expiry and whoever wrote it last.
 *
 * Returns null when the slug isn't a package that exists, which is a code or
 * config mistake rather than something a member can cause.
 */
export async function grantProduct(
  userId: number,
  slug: string,
  opts: { source?: EntitlementSource; externalId?: string | null; expiresAt?: Date | null; grantedBy?: number | null } = {},
): Promise<"granted" | "renewed" | null> {
  const product = await db.query.coachingProducts.findFirst({ where: eq(coachingProducts.slug, slug) });
  if (!product) return null;
  const values = {
    userId,
    productId: product.id,
    source: opts.source ?? ("manual" as EntitlementSource),
    externalId: opts.externalId ?? null,
    expiresAt: opts.expiresAt ?? null,
    grantedBy: opts.grantedBy ?? null,
  };
  const existing = await db.query.coachingEntitlements.findFirst({
    where: and(eq(coachingEntitlements.userId, userId), eq(coachingEntitlements.productId, product.id)),
  });
  await db
    .insert(coachingEntitlements)
    .values(values)
    .onConflictDoUpdate({
      target: [coachingEntitlements.userId, coachingEntitlements.productId],
      set: { source: values.source, externalId: values.externalId, expiresAt: values.expiresAt, grantedBy: values.grantedBy },
    });
  return existing ? "renewed" : "granted";
}

/** Take a package away. Idempotent, so a webhook for an already-cancelled membership is not an error. */
export async function revokeProduct(userId: number, slug: string): Promise<boolean> {
  const product = await db.query.coachingProducts.findFirst({ where: eq(coachingProducts.slug, slug) });
  if (!product) return false;
  const removed = await db
    .delete(coachingEntitlements)
    .where(and(eq(coachingEntitlements.userId, userId), eq(coachingEntitlements.productId, product.id)))
    .returning({ id: coachingEntitlements.id });
  return removed.length > 0;
}

export type EntitlementListing = {
  entitlementId: number;
  userId: number;
  name: string;
  discordUsername: string;
  slug: string;
  productName: string;
  source: string;
  externalId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  grantedByName: string | null;
  lapsed: boolean;
};

/** One row per holding, by driver name, for the staff page. Lapsed ones are included and marked. */
export async function listAllEntitlements(now: Date = new Date()): Promise<EntitlementListing[]> {
  const rows = await db
    .select({
      entitlementId: coachingEntitlements.id,
      userId: users.id,
      name: users.name,
      discordUsername: users.discordUsername,
      slug: coachingProducts.slug,
      productName: coachingProducts.name,
      source: coachingEntitlements.source,
      externalId: coachingEntitlements.externalId,
      expiresAt: coachingEntitlements.expiresAt,
      createdAt: coachingEntitlements.createdAt,
      grantedBy: coachingEntitlements.grantedBy,
    })
    .from(coachingEntitlements)
    .innerJoin(users, eq(coachingEntitlements.userId, users.id))
    .innerJoin(coachingProducts, eq(coachingEntitlements.productId, coachingProducts.id))
    .orderBy(asc(users.name), asc(coachingProducts.id));

  // The coach who wrote the row is a second read on the same table, because
  // "users" joined to itself would need an alias and this list is short.
  const grantorIds = [...new Set(rows.map((r) => r.grantedBy).filter((id): id is number => id !== null))];
  const grantors = grantorIds.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, grantorIds))
    : [];
  const grantorName = new Map(grantors.map((g) => [g.id, g.name]));

  return rows.map(({ grantedBy, ...r }) => ({
    ...r,
    grantedByName: grantedBy === null ? null : (grantorName.get(grantedBy) ?? null),
    lapsed: !entitlementCounts(r, now),
  }));
}

/** Who a package can be granted to: everyone who might buy one, so not the coaches' own rows. */
export async function listGrantCandidates() {
  return db
    .select({ id: users.id, name: users.name, discordUsername: users.discordUsername, role: users.role })
    .from(users)
    .where(inArray(users.role, ["student", "moderator"]))
    .orderBy(asc(users.name));
}

// ---------------------------------------------------------------- profiles

/** A profile as the pages read it: the two jsonb lists already strings. */
export type CoachingProfile = {
  id: number;
  userId: number;
  name: string;
  email: string;
  srBand: string;
  drBand: string;
  experience: string;
  classes: string[];
  goal: string;
  setupLink: string | null;
  video: string;
  createdAt: Date;
  updatedAt: Date;
};

/** The intake someone has filled in, or null when they haven't yet. */
export async function getCoachingProfile(userId: number): Promise<CoachingProfile | null> {
  const row = await db.query.coachingProfiles.findFirst({ where: eq(coachingProfiles.userId, userId) });
  if (!row) return null;
  const { classes, ...rest } = row;
  return { ...rest, classes: nameList(classes) };
}

/**
 * Write the intake, creating the row on the first save.
 *
 * One row per account, so editing is the same call as submitting: the profile a
 * coach is reading is always the latest one the driver sent.
 */
export async function saveCoachingProfile(userId: number, intake: Intake, at: Date = new Date()): Promise<void> {
  const values = { ...intake, userId, updatedAt: at };
  await db
    .insert(coachingProfiles)
    .values(values)
    .onConflictDoUpdate({ target: coachingProfiles.userId, set: { ...intake, updatedAt: at } });
}

/** A jsonb column read as a list of names, ignoring anything that isn't one. */
function nameList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

// ---------------------------------------------------------------- notes

/** A note as the pages read it, with the name of whoever wrote it already on it. */
export type CoachingNote = {
  id: number;
  userId: number;
  authorId: number;
  authorName: string;
  body: string;
  createdAt: Date;
};

/**
 * Everything written about one driver, newest first.
 *
 * Newest first because this list is opened before a session, when the question is
 * what was last worked on rather than what the first session covered. The author's
 * name is joined in because more than one coach may write on one student.
 */
export async function listCoachingNotes(userId: number): Promise<CoachingNote[]> {
  return db
    .select({
      id: coachingNotes.id,
      userId: coachingNotes.userId,
      authorId: coachingNotes.authorId,
      authorName: users.name,
      body: coachingNotes.body,
      createdAt: coachingNotes.createdAt,
    })
    .from(coachingNotes)
    .innerJoin(users, eq(users.id, coachingNotes.authorId))
    .where(eq(coachingNotes.userId, userId))
    .orderBy(desc(coachingNotes.createdAt), desc(coachingNotes.id));
}

/** Write a note about a driver, as whoever is at the keyboard. */
export async function addCoachingNote(userId: number, authorId: number, body: string): Promise<void> {
  await db.insert(coachingNotes).values({ userId, authorId, body });
}

/** One note by id, for the page that deletes it. Its body isn't needed there. */
export async function getCoachingNote(id: number) {
  return db.query.coachingNotes.findFirst({
    where: eq(coachingNotes.id, id),
    columns: { userId: true, authorId: true },
  });
}

/** Take a note away. False when there was no such note, so a double click isn't an error. */
export async function deleteCoachingNote(id: number): Promise<boolean> {
  const removed = await db.delete(coachingNotes).where(eq(coachingNotes.id, id)).returning({ id: coachingNotes.id });
  return removed.length > 0;
}

export type CoachingStudentRow = {
  userId: number;
  name: string;
  discordUsername: string;
  /** When their intake was last saved, or null while it's still missing. */
  intakeAt: Date | null;
  goal: string | null;
  noteCount: number;
  lastNoteAt: Date | null;
};

/**
 * Who holds the 1-on-1 package, by name, with how much of each profile is filled
 * in and how many notes sit on it. This is the list a coach opens to work.
 *
 * A lapsed holding is left out: a driver who stopped paying isn't a session
 * waiting to happen. Their rows stay, notes included, so a renewal puts them back
 * on the list with everything they'd built up still there.
 */
export async function listCoachingStudents(now: Date = new Date()): Promise<CoachingStudentRow[]> {
  const held = await db
    .select({
      userId: users.id,
      name: users.name,
      discordUsername: users.discordUsername,
      expiresAt: coachingEntitlements.expiresAt,
      intakeAt: coachingProfiles.updatedAt,
      goal: coachingProfiles.goal,
    })
    .from(coachingEntitlements)
    .innerJoin(coachingProducts, eq(coachingEntitlements.productId, coachingProducts.id))
    .innerJoin(users, eq(coachingEntitlements.userId, users.id))
    .leftJoin(coachingProfiles, eq(coachingProfiles.userId, users.id))
    .where(eq(coachingProducts.slug, ONE_TO_ONE));

  const tallied = await db
    .select({
      userId: coachingNotes.userId,
      n: sql<number>`count(*)::int`,
      lastAt: sql<Date | null>`max(${coachingNotes.createdAt})`,
    })
    .from(coachingNotes)
    .groupBy(coachingNotes.userId);
  const tally = new Map(tallied.map((t) => [t.userId, t]));

  return held
    .filter((r) => entitlementCounts(r, now))
    .map(({ expiresAt, ...r }) => ({
      ...r,
      noteCount: tally.get(r.userId)?.n ?? 0,
      lastNoteAt: tally.get(r.userId)?.lastAt ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
