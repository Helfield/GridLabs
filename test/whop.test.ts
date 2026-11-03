// Reading a Whop webhook, tested without a database or a server. The route that
// wires this to the entitlements rows is src/routes/whop.ts; the decisions are all
// in src/whop.ts, which holds nothing but the payload and the clock it's given.
import { test, expect } from "bun:test";
import { createHmac } from "node:crypto";
import {
  MAX_EVENT_AGE_SECONDS,
  planSlugFor,
  readWhopEvent,
  verifyWhopSignature,
  whopEventAction,
  WHOP_PLAN_MAP,
  WHOP_SLUGS,
} from "../src/whop";
import { LIVE_EVENTS, ONE_TO_ONE } from "../src/coachingRules";

// A secret in the shape Whop hands out: a prefix, then base64 of the raw key.
const SECRET = "ws_" + Buffer.alloc(32, 7).toString("base64");
const OTHER_SECRET = "ws_" + Buffer.alloc(32, 9).toString("base64");
const NOW = 1_762_000_000;

function sign(body: string, id: string, timestamp: string, secret = SECRET): string {
  return createHmac("sha256", Buffer.from(secret.slice(3), "base64")).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64");
}

const PAYLOAD = JSON.stringify({
  id: "evt_9Kd2mQx",
  type: "membership.activated",
  created_at: NOW,
  data: { id: "membership_4Zq8", plan: { id: "plan_rD3iTBA9eZZ3B" } },
});

// ------------------------------------------------------------------ signature

test("a delivery Whop signed is believed", () => {
  const timestamp = String(NOW);
  const check = verifyWhopSignature({
    secret: SECRET,
    body: PAYLOAD,
    id: "msg_1",
    timestamp,
    signature: `v1,${sign(PAYLOAD, "msg_1", timestamp)}`,
    now: NOW,
  });
  expect(check).toEqual({ ok: true, reason: null });
});

test("one changed byte of the body is not", () => {
  const timestamp = String(NOW);
  const signature = `v1,${sign(PAYLOAD, "msg_1", timestamp)}`;
  const tampered = PAYLOAD.replace("activated", "cancelled");
  expect(tampered).not.toBe(PAYLOAD);
  expect(
    verifyWhopSignature({ secret: SECRET, body: tampered, id: "msg_1", timestamp, signature, now: NOW }).ok,
  ).toBe(false);
});

test("a delivery signed with someone else's secret is not", () => {
  const timestamp = String(NOW);
  expect(
    verifyWhopSignature({
      secret: SECRET,
      body: PAYLOAD,
      id: "msg_1",
      timestamp,
      signature: `v1,${sign(PAYLOAD, "msg_1", timestamp, OTHER_SECRET)}`,
      now: NOW,
    }).ok,
  ).toBe(false);
});

test("any of the signatures in the header will do, because a rotation sends two", () => {
  const timestamp = String(NOW);
  const stale = `v1,${sign(PAYLOAD, "msg_1", timestamp, OTHER_SECRET)}`;
  const current = `v1,${sign(PAYLOAD, "msg_1", timestamp)}`;
  expect(
    verifyWhopSignature({ secret: SECRET, body: PAYLOAD, id: "msg_1", timestamp, signature: `${stale} ${current}`, now: NOW }).ok,
  ).toBe(true);
});

test("a header holding something other than a v1 signature is refused", () => {
  const timestamp = String(NOW);
  for (const signature of ["", "v2,abc", "abc", `notbase64!!$`]) {
    expect(verifyWhopSignature({ secret: SECRET, body: PAYLOAD, id: "msg_1", timestamp, signature, now: NOW }).ok).toBe(false);
  }
});

test("all three headers are needed", () => {
  const timestamp = String(NOW);
  const signature = `v1,${sign(PAYLOAD, "msg_1", timestamp)}`;
  const full = { secret: SECRET, body: PAYLOAD, id: "msg_1", timestamp, signature, now: NOW };
  expect(verifyWhopSignature({ ...full, id: null }).ok).toBe(false);
  expect(verifyWhopSignature({ ...full, timestamp: null }).ok).toBe(false);
  expect(verifyWhopSignature({ ...full, signature: null }).ok).toBe(false);
});

test("a delivery is refused once the timestamp is a day old, and believed up to it", () => {
  const timestamp = String(NOW);
  const signature = `v1,${sign(PAYLOAD, "msg_1", timestamp)}`;
  const full = { secret: SECRET, body: PAYLOAD, id: "msg_1", timestamp, signature };
  expect(verifyWhopSignature({ ...full, now: NOW + MAX_EVENT_AGE_SECONDS }).ok).toBe(true);
  expect(verifyWhopSignature({ ...full, now: NOW + MAX_EVENT_AGE_SECONDS + 1 }).reason).toContain("older than a day");
  // Retry queues can put a timestamp slightly ahead of a lagging clock, so the
  // window is measured either way rather than only one.
  expect(verifyWhopSignature({ ...full, now: NOW - MAX_EVENT_AGE_SECONDS - 1 }).ok).toBe(false);
});

test("a secret that isn't a signing secret is said so rather than guessed with", () => {
  const timestamp = String(NOW);
  const check = verifyWhopSignature({
    secret: "not base64 at all",
    body: PAYLOAD,
    id: "msg_1",
    timestamp,
    signature: `v1,${sign(PAYLOAD, "msg_1", timestamp)}`,
    now: NOW,
  });
  expect(check.ok).toBe(false);
  expect(check.reason).toContain("signing secret");
});

// -------------------------------------------------------------------- events

test("the events that bring access in", () => {
  for (const type of ["payment.succeeded", "checkout.completed", "membership.activated", "membership.renewed"]) {
    expect(whopEventAction(type)).toBe("grant");
  }
});

test("the events that take it away", () => {
  for (const type of [
    "payment.failed",
    "payment.refunded",
    "membership.cancelled",
    "membership.expired",
    "membership.deleted",
    "dispute.created",
  ]) {
    expect(whopEventAction(type)).toBe("revoke");
  }
});

test("a plan change is its own case, because the old package isn't cancelled by it", () => {
  expect(whopEventAction("membership.plan_changed")).toBe("swap");
});

test("an event nobody has listed is not acted on", () => {
  expect(whopEventAction("ad_campaign.created")).toBeNull();
  expect(whopEventAction("account.updated")).toBeNull();
  expect(whopEventAction("")).toBeNull();
});

// -------------------------------------------------------------------- plans

test("the two checkout links map to the two packages", () => {
  expect(WHOP_PLAN_MAP["plan_rD3iTBA9eZZ3B"]).toBe(ONE_TO_ONE);
  expect(WHOP_PLAN_MAP["plan_mdBqlDxD38Ryj"]).toBe(LIVE_EVENTS);
  expect([...WHOP_SLUGS].sort()).toEqual([LIVE_EVENTS, ONE_TO_ONE].sort());
});

test("the first known package in a payload wins, and an unknown one is nothing", () => {
  expect(planSlugFor(["plan_mdBqlDxD38Ryj", "plan_rD3iTBA9eZZ3B"])).toBe(LIVE_EVENTS);
  expect(planSlugFor(["plan_zzzzzzzzzz"])).toBeNull();
  expect(planSlugFor([])).toBeNull();
});

// ------------------------------------------------------------------ payload

test("a membership delivery is read whatever depth it carries its fields at", () => {
  const ev = readWhopEvent({
    id: "evt_1",
    type: "membership.activated",
    api_version: "2026-11-03",
    data: {
      id: "membership_8Kd92La",
      status: "active",
      current_period_end: 1_764_000_000,
      variant: { id: "plan_rD3iTBA9eZZ3B", name: "VIP Monthly" },
      user: {
        id: "user_44",
        email: "Brent@Example.com",
        social_discord_user_id: "1530657771672961205",
        social_discord_username: "brent",
        avatar_url: "https://cdn.discordapp.com/avatars/1530657771672961205/a.png",
      },
    },
  });

  expect(ev.id).toBe("evt_1");
  expect(ev.type).toBe("membership.activated");
  expect(ev.membershipId).toBe("membership_8Kd92La");
  expect(ev.planIds).toEqual(["plan_rD3iTBA9eZZ3B"]);
  expect(ev.expiresAt?.toISOString()).toBe(new Date(1_764_000_000 * 1000).toISOString());
  expect(ev.identity.discordIds).toEqual(["1530657771672961205"]);
  expect(ev.identity.usernames).toEqual(["brent"]);
  expect(ev.identity.emails).toEqual(["brent@example.com"]);
});

test("a variant id is read as a plan id, since Whop now sells variants", () => {
  const ev = readWhopEvent({ type: "payment.succeeded", data: { variant: { id: "variant_7Hq2" } } });
  expect(ev.planIds).toEqual(["variant_7Hq2"]);
});

test("the address a Discord sign-in invents is not treated as an email", () => {
  const ev = readWhopEvent({
    type: "membership.activated",
    data: { user: { email: "1530657771672961205@discord.unknown", discord_id: "1530657771672961205" } },
  });
  expect(ev.identity.emails).toEqual([]);
  expect(ev.identity.discordIds).toEqual(["1530657771672961205"]);
});

test("a Discord link is not a username", () => {
  const ev = readWhopEvent({
    type: "membership.activated",
    data: { user: { discord_avatar_url: "https://cdn.discordapp.com/avatars/15/abc.png", discord: "connor.b" } },
  });
  expect(ev.identity.usernames).toEqual(["connor.b"]);
  expect(ev.identity.discordIds).toEqual([]);
});

test("the latest end date is the one kept, so a previous period can't cut access short", () => {
  const ev = readWhopEvent({
    type: "membership.renewed",
    data: { previous: { current_period_end: 1_700_000_000 }, current_period_end: 1_800_000_000 },
  });
  expect(ev.expiresAt?.getTime()).toBe(1_800_000_000 * 1000);
});

test("a timestamp that isn't an end date never becomes one", () => {
  const ev = readWhopEvent({ type: "payment.succeeded", created_at: 1_762_000_000, data: { paid_at: 1_762_000_000 } });
  expect(ev.expiresAt).toBeNull();
});

test("a delivery naming nothing usable says so in every field rather than throwing", () => {
  const ev = readWhopEvent({ type: "membership.activated", data: { status: "active" } });
  expect(ev.planIds).toEqual([]);
  expect(ev.membershipId).toBeNull();
  expect(ev.identity).toEqual({ discordIds: [], usernames: [], emails: [] });
});

test("the paths things were found on are recorded, and the values are not", () => {
  const ev = readWhopEvent({
    type: "membership.activated",
    data: { plan: { id: "plan_rD3iTBA9eZZ3B" }, user: { email: "someone@example.com" } },
  });
  expect(ev.paths.plan).toEqual(["data.plan.id"]);
  expect(ev.paths.email).toEqual(["data.user.email"]);
  const logged = JSON.stringify(ev.paths);
  expect(logged).not.toContain("someone@example.com");
});

test("a list of items is walked, because a checkout can carry more than one line", () => {
  const ev = readWhopEvent({
    type: "checkout.completed",
    data: { items: [{ variant: { id: "plan_mdBqlDxD38Ryj" } }, { variant: { id: "plan_rD3iTBA9eZZ3B" } }] },
  });
  expect(ev.planIds).toEqual(["plan_mdBqlDxD38Ryj", "plan_rD3iTBA9eZZ3B"]);
});

test("the plan a membership moved to is read before the one it moved from", () => {
  // Whop has to name both in a plan change, and acting on the wrong one would put
  // someone back on the package they just gave up. Field order is no help, so the
  // path is what decides.
  const ev = readWhopEvent({
    type: "membership.plan_changed",
    data: {
      previous_plan: { id: "plan_mdBqlDxD38Ryj" },
      plan: { id: "plan_rD3iTBA9eZZ3B" },
    },
  });
  expect(ev.planIds).toEqual(["plan_rD3iTBA9eZZ3B", "plan_mdBqlDxD38Ryj"]);
  expect(planSlugFor(ev.planIds)).toBe(ONE_TO_ONE);
});

test("the same read holds when the old plan is listed last", () => {
  const ev = readWhopEvent({
    type: "membership.plan_changed",
    data: { plan: { id: "plan_mdBqlDxD38Ryj" }, old_variant: { id: "plan_rD3iTBA9eZZ3B" } },
  });
  expect(planSlugFor(ev.planIds)).toBe(LIVE_EVENTS);
});

test("a payload that isn't an object at all is read as an empty one", () => {
  for (const payload of [null, "hello", 42, []]) {
    const ev = readWhopEvent(payload);
    expect(ev.type).toBe("");
    expect(ev.planIds).toEqual([]);
  }
});
