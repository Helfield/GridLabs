/**
 * whop.ts
 *
 * The door Whop knocks on when money moves.
 *
 * This is the only part of the site that knows Whop exists. It reads a delivery,
 * decides which package it is talking about and which account it belongs to, then
 * writes that through the same grant and revoke the coach's own admin screen uses,
 * with the source recorded as `whop_webhook`. Every gated page on the site keeps
 * asking one question of the entitlements table and never learns that a payment
 * platform was involved, which is what the design was built to keep true.
 *
 * Nothing here is behind a session, so the signature is the whole of the trust:
 * a delivery that doesn't carry one made with the webhook's secret is refused
 * before any of it is read as an instruction.
 */

import { Hono } from "hono";
import { planSlugFor, readWhopEvent, verifyWhopSignature, whopEventAction, WHOP_SLUGS, type WhopEvent } from "../whop";
import { findUserByIdentity } from "../db/queries";
import { getEntitlementsForUser, grantProduct, revokeProduct } from "../db/coaching";

export const whopRoutes = new Hono();

/** Whop's own deliveries are a few kilobytes. Anything larger isn't one of them. */
const MAX_BODY_BYTES = 65536;

const note = (message: string) => console.log(`Whop: ${message}`);
const warn = (message: string) => console.error(`Whop: ${message}`);

/**
 * So someone can check the door is there without Whop having to knock.
 *
 * The endpoint URL has to be typed into Whop's dashboard before the route that
 * answers it is deployed, which makes "did my deploy land" worth being one GET
 * rather than a guess. No secret, no member data, nothing an account can be taken
 * from.
 */
whopRoutes.get("/webhook", (c) => c.json({ receiver: "whop", accepts: "POST", verified_by: "webhook-signature" }));

whopRoutes.post("/webhook", async (c) => {
  const secret = process.env.WHOP_WEBHOOK_SECRET?.trim();
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return c.json({ error: "Payload too large for a Whop delivery." }, 413);

  // The bytes as sent, once. Parsing first and re-serialising would sign a
  // different string than Whop did.
  const body = await c.req.raw.text();
  if (body.length > MAX_BODY_BYTES) return c.json({ error: "Payload too large for a Whop delivery." }, 413);

  if (!secret) {
    // 503 rather than 401: nothing was wrong with the delivery, and Whop retries
    // this one after the variable is set and the service redeployed.
    warn("no WHOP_WEBHOOK_SECRET set, so nothing can be believed. Add it in Railway's Variables and redeploy.");
    return c.json({ error: "This site hasn't been given the webhook's signing secret yet." }, 503);
  }

  const check = verifyWhopSignature({
    secret,
    body,
    id: c.req.header("webhook-id"),
    timestamp: c.req.header("webhook-timestamp"),
    signature: c.req.header("webhook-signature"),
  });
  if (!check.ok) {
    warn(`refused a delivery, ${check.reason}.`);
    return c.json({ error: "That delivery didn't sign itself correctly." }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: "That isn't JSON." }, 400);
  }

  const ev = readWhopEvent(payload);
  const action = whopEventAction(ev.type);
  if (!action) {
    // Named rather than swallowed: this is how an event that should have moved
    // access gets noticed instead of quietly doing nothing.
    note(`ignored ${ev.type || "an untyped event"} (${ev.id ?? "no id"}), which isn't one this site acts on.`);
    return c.json({ received: true, action: "ignored" });
  }

  const slug = planSlugFor(ev.planIds);
  if (!slug) {
    warn(
      `${ev.type} names ${ev.planIds.length ? `no package this site sells (saw ${ev.planIds.join(", ")})` : "no plan or variant id at all"}. ` +
        `Add it to WHOP_PLAN_MAP in src/whop.ts. Paths read: ${describe(ev)}.`,
    );
    // 200: Whop would retry a failure forever and the fix is a code change, not a
    // resend. The log line above is the thing to act on.
    return c.json({ received: true, action: "unmapped" });
  }

  const { user, matchedBy } = await findUserByIdentity(ev.identity);
  if (!user) {
    warn(
      `${ev.type} for ${slug} names a buyer nobody here matches. Tried ${counters(ev)}. ` +
        `Grant it from /coaching/admin if they've signed in, and check the paths: ${describe(ev)}.`,
    );
    return c.json({ received: true, action: "unmatched" });
  }

  if (action === "swap") {
    // The event that changes a membership doesn't cancel the package it changed
    // away from, so that one is taken back here, and only when it carries this
    // same membership id. An entitlement a coach added by hand is left alone.
    const held = await getEntitlementsForUser(user.id);
    for (const row of held) {
      if (row.slug === slug || !WHOP_SLUGS.has(row.slug)) continue;
      if (!ev.membershipId || row.externalId !== ev.membershipId) continue;
      await revokeProduct(user.id, row.slug);
      note(`took ${row.slug} back from account ${user.id} when their membership moved to ${slug}.`);
    }
  }

  if (action === "revoke") {
    const removed = await revokeProduct(user.id, slug);
    note(`${ev.type}: ${removed ? "took" : "had nothing to take"} on ${slug} for account ${user.id} (matched by ${matchedBy}).`);
    return c.json({ received: true, action, changed: removed });
  }

  const result = await grantProduct(user.id, slug, {
    source: "whop_webhook",
    externalId: ev.membershipId,
    expiresAt: ev.expiresAt,
  });
  if (!result) {
    warn(`${ev.type} named ${slug}, which isn't a package in coaching_products.`);
    return c.json({ received: true, action: "unknown-package" });
  }
  note(
    `${ev.type}: ${result} ${slug} for account ${user.id} (matched by ${matchedBy})` +
      `${ev.expiresAt ? ` until ${ev.expiresAt.toISOString()}` : ", with no end date in the payload"}.`,
  );
  return c.json({ received: true, action, result });
});

/**
 * Where the reader found each thing, as paths only.
 *
 * A payload's values are a member's email and Discord id, which don't belong in a
 * log anyone can read. Its field names are exactly what does need seeing, because
 * they are what tells us which shape this business's API version actually sends.
 */
function describe(ev: WhopEvent): string {
  const parts = Object.entries(ev.paths)
    .filter(([, found]) => found.length > 0)
    .map(([what, found]) => `${what} at ${found.slice(0, 4).join(", ")}`);
  return parts.length ? parts.join("; ") : "no recognisable fields";
}

function counters(ev: WhopEvent): string {
  const { discordIds, usernames, emails } = ev.identity;
  const parts = [
    discordIds.length ? `${discordIds.length} Discord id(s)` : "",
    usernames.length ? `${usernames.length} username(s)` : "",
    emails.length ? `${emails.length} email(s)` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing that names a buyer";
}
