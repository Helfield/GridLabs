/**
 * coaching.ts
 *
 * The paid-coaching rows: which packages exist and who holds them.
 *
 * This is the only place access is decided, and it decides it from the
 * entitlements table alone. That is what keeps the payment gateway out of the
 * rest of the site: when Whop is connected it writes these same rows from its
 * webhook, and every gate on the site carries on asking the same question of the
 * same table without knowing anything happened.
 *
 * The rules themselves -- whether an entitlement still counts, whether a pasted
 * link is usable -- are in src/coachingRules.ts, which holds no database.
 */

import { db } from "./client";
import { coachingEntitlements, coachingProducts, coachingProfiles, users } from "./schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { entitlementCounts, type Intake } from "../coachingRules";

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
