/**
 * whop.ts
 *
 * Reading a Whop webhook: whether a delivery really came from Whop, and what it is
 * asking the club to do. No database and no HTTP in here, so a payload written by
 * hand proves every branch. The same split as src/coachingRules.ts. It also holds
 * the ids Whop is mapped to and the checkout links the packages are sold at, so the
 * provider's own identifiers live in one file rather than in a page.
 *
 * Whop names its fields by API version, and the version pinned on the webhook
 * decides which shape arrives. Nobody has read a real delivery from this business
 * yet, so the reader collects what it recognises from anywhere in the payload
 * rather than trusting one path, and records the paths it found things on. Those
 * paths are what turn the guesses into facts: the route logs them, and the first
 * live delivery says which field names to keep.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { LIVE_EVENTS, ONE_TO_ONE } from "./coachingRules";

/**
 * Whop's own ids for the two things the club sells, as the package each one is.
 *
 * VIP Monthly is the 1-on-1 package and All Access Monthly is the live-events one;
 * the owner said which is which. Both spellings of a purchasable thing are allowed
 * in a payload, since Whop now calls them variants and keeps `plan_...` as a
 * compatibility id, so a `variant_...` id for either product goes in here the first
 * time one is seen in a delivery. Anything not listed is logged rather than
 * guessed at: inventing a mapping would hand someone the wrong access.
 */
export const WHOP_PLAN_MAP: Record<string, string> = {
  plan_rD3iTBA9eZZ3B: ONE_TO_ONE,
  plan_mdBqlDxD38Ryj: LIVE_EVENTS,
};

/** The packages Whop is allowed to write. Anything else on an account came from a coach. */
export const WHOP_SLUGS: ReadonlySet<string> = new Set(Object.values(WHOP_PLAN_MAP));

/**
 * The two checkout pages, keyed by package slug, as the owner wrote them.
 *
 * Deliberately not derived from WHOP_PLAN_MAP. That map holds whatever id a
 * delivery happens to name, and Whop may one day name a `variant_...` there;
 * these are the links a person clicks, and the plan links are what the shop
 * answers on. Both list the same two ids today, and a change to one should be
 * checked against the other rather than inherited from it.
 */
export const WHOP_CHECKOUT_LINKS: Record<string, string> = {
  [ONE_TO_ONE]: "https://whop.com/checkout/plan_rD3iTBA9eZZ3B",
  [LIVE_EVENTS]: "https://whop.com/checkout/plan_mdBqlDxD38Ryj",
};

/**
 * How far back a delivery may be signed.
 *
 * The usual five minutes would be tighter than Whop's own retry window, so a
 * purchase made while the site was mid-deploy would arrive too late to be believed
 * and the member would never get access. A day survives that. Replay is bounded by
 * this window and made harmless by the writes being idempotent.
 */
export const MAX_EVENT_AGE_SECONDS = 86400;

// ---------------------------------------------------------------- signature

export type SignatureCheck = { ok: boolean; reason: string | null };

/**
 * Does this delivery carry a signature Whop could have made.
 *
 * Whop signs `{webhook-id}.{webhook-timestamp}.{raw body}` with HMAC-SHA256 under
 * the webhook's secret, which is what the `webhook-signature` header carries as one
 * or more `v1,<base64>` entries. More than one is normal while a secret is being
 * rotated, so every entry is tried.
 *
 * The body has to be the bytes as sent, before anything parses them: re-serialising
 * the JSON changes the spacing and the signature stops matching for a delivery that
 * was genuine.
 */
export function verifyWhopSignature(opts: {
  secret: string;
  body: string;
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
  /** Unix seconds, so a test can put the clock anywhere it likes. */
  now?: number;
}): SignatureCheck {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!opts.id || !opts.timestamp || !opts.signature) return { ok: false, reason: "no webhook-id, webhook-timestamp or webhook-signature header" };

  const sent = Number(opts.timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "webhook-timestamp isn't a number" };
  if (Math.abs(now - sent) > MAX_EVENT_AGE_SECONDS) return { ok: false, reason: "delivery is older than a day" };

  const key = signingKey(opts.secret);
  if (key.length === 0) return { ok: false, reason: "WHOP_WEBHOOK_SECRET isn't a Whop signing secret" };

  const expected = createHmac("sha256", key).update(`${opts.id}.${opts.timestamp}.${opts.body}`, "utf8").digest();
  const offered = opts.signature
    .split(" ")
    .map((entry) => entry.split(","))
    .filter(([version, value]) => version === "v1" && !!value)
    .map(([, value]) => Buffer.from(value, "base64"));
  if (offered.length === 0) return { ok: false, reason: "webhook-signature holds no v1 signature" };

  const matched = offered.some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected));
  return matched ? { ok: true, reason: null } : { ok: false, reason: "signature doesn't match this payload" };
}

/**
 * The raw key inside the secret.
 *
 * Whop hands out `ws_` followed by the base64 of that key, so the prefix comes off
 * and the rest is decoded rather than used as text. Other providers in this scheme
 * use a different prefix over the same encoding, so any leading `xxx_` is stripped.
 *
 * Something that isn't base64 yields no key rather than a guess at one. A secret
 * pasted from the wrong field in the dashboard would otherwise fail every delivery
 * with "signature doesn't match", which points at Whop instead of at the variable.
 */
function signingKey(secret: string): Buffer {
  const raw = secret.trim();
  const under = raw.indexOf("_");
  const body = under > 0 && under <= 8 ? raw.slice(under + 1) : raw;
  const cleaned = body.replace(/\s/g, "");
  // Both base64 alphabets are allowed because a key copied from a dashboard can
  // arrive padded or not, and neither changes the bytes underneath.
  if (!/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(cleaned)) return Buffer.alloc(0);
  const key = Buffer.from(cleaned, "base64");
  return key.length >= 16 ? key : Buffer.alloc(0);
}

// ---------------------------------------------------------------- events

/** Events that mean a package should be on the account. */
const GRANT_EVENTS = new Set(["payment.succeeded", "checkout.completed", "membership.activated", "membership.renewed"]);

/** Events that mean it should come off. */
const REVOKE_EVENTS = new Set([
  "payment.failed",
  "payment.refunded",
  "membership.cancelled",
  "membership.canceled",
  "membership.expired",
  "membership.deleted",
  "dispute.created",
]);

/** What the route is asked to do with an entitlement. */
export type WhopAction = "grant" | "revoke" | "swap";

/**
 * Grant, revoke, or move one off and this one on.
 *
 * A plan change is its own case because the old package doesn't come with it:
 * someone moving from VIP to All Access leaves a 1-on-1 entitlement sitting on
 * their account that nothing will ever cancel, since Whop now only talks about the
 * membership it just changed. The route handles that by taking back the other
 * package belonging to the same membership id.
 *
 * An event name that isn't listed returns null and is logged. That is deliberate:
 * the names come from Whop's version-pinned catalogue, the first real delivery will
 * show ones nobody has typed into this file yet, and a line in the log is a better
 * outcome than silently doing nothing or, worse, guessing.
 */
export function whopEventAction(type: string): WhopAction | null {
  if (type === "membership.plan_changed" || type === "membership.plan_change") return "swap";
  if (GRANT_EVENTS.has(type)) return "grant";
  if (REVOKE_EVENTS.has(type)) return "revoke";
  return null;
}

// ---------------------------------------------------------------- payload

/** The identities a payload might name a buyer by, in the order they can be trusted. */
export type WhopIdentity = { discordIds: string[]; usernames: string[]; emails: string[] };

export type WhopEvent = {
  /** The delivery's own id, from the envelope. */
  id: string | null;
  type: string;
  /** Whop's id for this purchase, so a later event finds the same entitlement row. */
  membershipId: string | null;
  /** Every plan or variant id in the payload, the membership's current one first. */
  planIds: string[];
  /** End of the paid period, if the payload states one. */
  expiresAt: Date | null;
  identity: WhopIdentity;
  /** Where each of the above was found, as dotted paths. Values are never logged. */
  paths: Record<string, string[]>;
};

/**
 * Read a delivery into the facts the site needs.
 *
 * Nothing here is required: a payload that names no plan, or no buyer, is a
 * complete answer rather than a parse failure, and the route reports which of them
 * is missing. That is what lets one unknown shape be diagnosed from a log line
 * instead of guessed at from a docs page.
 */
export function readWhopEvent(payload: unknown): WhopEvent {
  const hits: Hit[] = [];
  collect(payload, "", hits);

  const paths = {
    plan: [] as string[],
    membership: [] as string[],
    expires: [] as string[],
    discordId: [] as string[],
    username: [] as string[],
    email: [] as string[],
  };

  /** What the membership is now, and what it used to be, kept apart by path. */
  const current: string[] = [];
  const superseded: string[] = [];
  const membershipIds: string[] = [];
  const discordIds: string[] = [];
  const usernames: string[] = [];
  const emails: string[] = [];
  let expiresAt: Date | null = null;

  for (const hit of hits) {
    const key = lastSegment(hit.path);

    if (isWhopId(hit.value, "plan") || isWhopId(hit.value, "variant")) {
      // A plan change names both the plan it moved to and the one it moved from,
      // and the route acts on the first id it can map, so the current one has to
      // come out first whatever order the payload listed them in. Whop's own
      // naming is the only thing that tells the two apart.
      if (/previous|prior|old|from|source/i.test(hit.path)) push(superseded, hit.value);
      else push(current, hit.value);
      push(paths.plan, hit.path);
      continue;
    }
    if (isWhopId(hit.value, "membership") || isWhopId(hit.value, "mem")) {
      push(membershipIds, hit.value);
      push(paths.membership, hit.path);
      continue;
    }

    // A buyer's identity, wherever the payload happens to carry it.
    if (/discord/i.test(key)) {
      if (/^\d{15,20}$/.test(hit.value)) {
        push(discordIds, hit.value);
        push(paths.discordId, hit.path);
        continue;
      }
      if (isDiscordUsername(hit.value)) {
        push(usernames, hit.value);
        push(paths.username, hit.path);
        continue;
      }
    }
    if (isEmail(hit.value)) {
      push(emails, hit.value.toLowerCase());
      push(paths.email, hit.path);
      continue;
    }

    // An end date only counts when the field says it is one, because a payload is
    // full of timestamps that mean something else.
    if (/period_end|expires|ends_at|end_date|renewal/i.test(key)) {
      const asDate = toDate(hit.value);
      if (asDate && (!expiresAt || asDate.getTime() > expiresAt.getTime())) {
        expiresAt = asDate;
        paths.expires = [hit.path];
      }
    }
  }

  return {
    id: typeof (payload as { id?: unknown })?.id === "string" ? ((payload as { id: string }).id) : null,
    type: typeof (payload as { type?: unknown })?.type === "string" ? ((payload as { type: string }).type) : "",
    membershipId: membershipIds[0] ?? null,
    planIds: [...current, ...superseded],
    expiresAt,
    identity: { discordIds, usernames, emails },
    paths,
  };
}

/** The package this delivery is about, or null when it isn't one the club sells. */
export function planSlugFor(planIds: string[]): string | null {
  for (const id of planIds) {
    const slug = WHOP_PLAN_MAP[id];
    if (slug) return slug;
  }
  return null;
}

// ---------------------------------------------------------------- reading

type Hit = { path: string; value: string };

/** Every string in the payload, with the path it sat at. */
function collect(node: unknown, path: string, out: Hit[], depth = 0): void {
  if (depth > 8) return;
  if (typeof node === "string") {
    out.push({ path, value: node });
    return;
  }
  if (typeof node === "number") {
    // Timestamps arrive as numbers, and a path is only useful if the value that
    // sat on it can be compared.
    out.push({ path, value: String(node) });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => collect(item, `${path}.${i}`, out, depth + 1));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) collect(value, path ? `${path}.${key}` : key, out, depth + 1);
  }
}

function lastSegment(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1] ?? "";
}

/** Whop's ids are a lowercase kind, an underscore and an opaque tail. */
function isWhopId(value: string, kind: string): boolean {
  return new RegExp(`^${kind}_[A-Za-z0-9]{4,}$`).test(value);
}

/**
 * A Discord handle rather than something else that mentions Discord.
 *
 * Avatar URLs and the invented `<id>@discord.unknown` address both live under keys
 * naming Discord, and neither is a username. The new-style names are alphanumerics
 * with dots and underscores, the old-style ones end in a four digit discriminator.
 */
function isDiscordUsername(value: string): boolean {
  if (!/^[A-Za-z0-9._#-]{2,32}$/.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
}

/**
 * An address that could belong to a member.
 *
 * Accounts made by the desktop app rather than the site carry `<id>@discord.unknown`,
 * which is a placeholder and not anyone's email. Matching a purchase on it would
 * grant access to whichever app account invented it first.
 */
function isEmail(value: string): boolean {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return false;
  return !value.toLowerCase().endsWith("@discord.unknown");
}

/** A unix second, a unix millisecond or an ISO date, or null for neither. */
function toDate(value: string): Date | null {
  if (/^\d{10}$/.test(value)) return new Date(Number(value) * 1000);
  if (/^\d{13}$/.test(value)) return new Date(Number(value));
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function push(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}
