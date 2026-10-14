import { Hono } from "hono";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import {
  getUserById,
  getAllStudents,
  getStudentDetail,
  getPublicReferenceLaps,
  getTrackProgress,
  createReferenceLap,
  deleteReferenceLap,
} from "../db/queries";
import { coachDashboardPage, driverDetailPage, referenceLapsPage } from "../views/coach-pages";
import { leaderboardEnabled, syncAllLeaderboards } from "../discord/leaderboard";
import { promoteBestLaps } from "../db/promotions";
import { discordPage } from "../views/coach-discord";
import { botEnabled, guildId, listAssignableRoles, listGuildEmojis, listTextChannels, parseEmoji } from "../discord/bot-api";
import { attachToMessage, createPanel, deleteMapping, emojisOnMessage, listReactionRoles, MAX_REACTIONS_PER_MESSAGE, type RolePair } from "../discord/reaction-roles";

export const coachRoutes = new Hono<{ Variables: AppVariables }>();

coachRoutes.use("*", requireAuth);

// Only coaches get past here -- students hitting these routes directly
// get redirected to their own dashboard instead.
coachRoutes.use("*", async (c, next) => {
  const user = await getUserById(c.get("userId"));
  if (!user || user.role !== "coach") {
    return c.redirect("/student");
  }
  await next();
});

coachRoutes.get("/", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  const students = await getAllStudents();
  return c.html(coachDashboardPage(user, students));
});

coachRoutes.get("/driver/:id", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  const studentId = Number(c.req.param("id"));
  const detail = await getStudentDetail(studentId);
  if (!detail) {
    return c.text("Driver not found.", 404);
  }
  // Same per-track/class gap table the driver sees on their own page --
  // a coach opening someone's profile wants the same answer they do:
  // which combination is furthest off the reference.
  const progress = await getTrackProgress(studentId);
  return c.html(driverDetailPage(user, detail.student, detail.sessions, detail.referenceLaps, progress));
});

// Global reference laps: upload a lap here and it appears for every
// student instantly via getPublicReferenceLaps(), no manual redownload.
coachRoutes.get("/reference-laps", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  const laps = await getPublicReferenceLaps();
  const synced = c.req.query("discord");
  const published = c.req.query("published");
  const removed = Number(c.req.query("removed") ?? 0);
  const notice =
    published !== undefined
      ? `Published ${published} new fastest lap${published === "1" ? "" : "s"}` +
        (removed > 0 ? `; took down ${removed} that no longer pass validation (track cuts).` : ".")
      : synced === undefined
        ? null
        : synced === "off"
          ? "Discord leaderboard is off -- set DISCORD_LEADERBOARD_WEBHOOK_URL in Railway's Variables to turn it on."
          : `Leaderboard re-posted (${synced} track${synced === "1" ? "" : "s"} on the board).`;
  return c.html(referenceLapsPage(user, laps, { enabled: leaderboardEnabled(), notice }));
});

// Publish the fastest valid lap per track and car class as a reference
// lap, from everything uploaded so far. Runs by itself on every upload
// and at startup; this is the "do it now" button.
coachRoutes.post("/promote-fastest", async (c) => {
  const result = await promoteBestLaps();
  return c.redirect(`/coach/reference-laps?published=${result.promoted}&removed=${result.unpublished}`);
});

// Rebuild every track's leaderboard message from scratch. The boards
// keep themselves current on upload, so this exists for the times the
// channel gets out of step by hand -- a message deleted, the webhook
// recreated -- and for the very first population.
coachRoutes.post("/discord-leaderboard/sync", async (c) => {
  const result = await syncAllLeaderboards({ repost: true });
  return c.redirect(`/coach/reference-laps?discord=${result.enabled ? result.tracks : "off"}`);
});

coachRoutes.post("/reference-laps", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");

  const body = await c.req.parseBody();
  const track = typeof body.track === "string" ? body.track.trim() : "";
  const car = typeof body.car === "string" ? body.car.trim() : "";
  // Display-only name. Never matched against telemetry -- purely so a
  // student reading the list knows what car the lap is in.
  const carDisplay = typeof body.carDisplay === "string" ? body.carDisplay.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const lapTimeSeconds = parseLapTime(typeof body.lapTime === "string" ? body.lapTime : "");
  const file = body.dataFile;

  if (!track || !car || !label || !(file instanceof File)) {
    return c.text("Missing required fields: track, car, label, and a reference lap JSON file.", 400);
  }

  let data: unknown;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    return c.text("The uploaded file isn't valid JSON.", 400);
  }

  await createReferenceLap({
    ownerId: user.id,
    track,
    car,
    carDisplay: carDisplay || null,
    label,
    data,
    lapTimeSeconds,
    isPublic: true,
  });

  return c.redirect("/coach/reference-laps");
});

coachRoutes.post("/reference-laps/:id/delete", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isFinite(id)) {
    await deleteReferenceLap(id);
  }
  return c.redirect("/coach/reference-laps");
});

/**
 * Lap time as a driver would type it -- "2:03.373" -- into seconds.
 *
 * Nobody reads a lap in raw seconds, so the form asks for the timing-screen
 * format. The millisecond separator is deliberately loose: "." is correct,
 * but ":" and "," are both common enough (and "2:03:373" is what a lot of
 * people type) that rejecting them would just be pedantry. A plain number
 * still works too, so anyone already used to entering seconds isn't broken.
 *
 * Returns null for empty or unparseable input rather than 0 -- a lap with
 * no time recorded is a real state, and a lap time of zero is not.
 */
function parseLapTime(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;

  const match = text.match(/^(\d+):([0-5]?\d)(?:[.,:](\d{1,3}))?$/);
  if (match) {
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    // "2:03.4" means 400ms, not 4ms -- pad right, not left.
    const millis = match[3] ? Number(match[3].padEnd(3, "0")) / 1000 : 0;
    return minutes * 60 + seconds + millis;
  }

  const plain = Number(text.replace(",", "."));
  return Number.isFinite(plain) && plain > 0 ? plain : null;
}
// Discord reaction roles. The bot itself runs from discord/gateway.ts; this
// page only edits what it listens for.
coachRoutes.get("/discord", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  const enabled = botEnabled();
  let error: string | null = null;
  let roles: Awaited<ReturnType<typeof listAssignableRoles>> = [];
  let channels: Awaited<ReturnType<typeof listTextChannels>> = [];
  let emojis: Awaited<ReturnType<typeof listGuildEmojis>> = [];
  if (enabled) {
    try {
      [roles, channels, emojis] = await Promise.all([listAssignableRoles(), listTextChannels(), listGuildEmojis()]);
    } catch (err) {
      console.error("Loading Discord roles/channels failed:", err);
      error = "Couldn't load the server's roles and channels. Is the bot invited to the server and is DISCORD_GUILD_ID right?";
    }
  }
  const notice = c.req.query("done") ? "Done — the reaction roles are live." : null;
  error = c.req.query("error") ?? error;
  return c.html(
    discordPage(user, { enabled, guildId: guildId(), notice, error, mappings: await listReactionRoles(), roles, channels, emojis }),
  );
});

coachRoutes.post("/discord/panel", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const one = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const many = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(one);
  const fail = (msg: string) => c.redirect(`/coach/discord?error=${encodeURIComponent(msg)}`);

  if (!botEnabled()) return fail("The bot is off.");
  const channelId = one(body.channelId);
  const messageId = one(body.messageId);
  if (!/^\d+$/.test(channelId)) return fail("Pick a channel.");
  if (messageId && !/^\d+$/.test(messageId)) return fail("The message ID should be a number.");

  // Only roles the page offers, so a hand-built request can't hand out a role it never showed.
  const [roles, customEmojis] = await Promise.all([listAssignableRoles(), listGuildEmojis()]);
  const emojis = many(body.emoji);
  const roleIds = many(body.roleId);
  const pairs: RolePair[] = [];
  for (let i = 0; i < emojis.length; i++) {
    if (!emojis[i] && !roleIds[i]) continue;
    const emoji = parseEmoji(emojis[i] ?? "", customEmojis);
    const role = roles.find((r) => r.id === roleIds[i]);
    if (!emoji || !role) return fail(`Row ${i + 1}: needs a real emoji and a role.`);
    if (pairs.some((p) => p.emoji === emoji)) return fail(`Row ${i + 1}: that emoji is already used.`);
    pairs.push({ emoji, roleId: role.id, roleName: role.name });
  }
  if (pairs.length === 0) return fail("Add at least one emoji and role.");
  // Discord stops a message at 20 different reactions; count what this message already carries.
  const already = messageId ? (await emojisOnMessage(messageId)).filter((e) => !pairs.some((p) => p.emoji === e)).length : 0;
  if (already + pairs.length > MAX_REACTIONS_PER_MESSAGE) {
    return fail(`Discord allows ${MAX_REACTIONS_PER_MESSAGE} reactions per message — that would be ${already + pairs.length}. Split it across two panels.`);
  }

  try {
    if (messageId) await attachToMessage(channelId, messageId, pairs);
    else await createPanel(channelId, one(body.text), pairs);
  } catch (err) {
    console.error("Creating reaction roles failed:", err);
    return fail("Discord refused. Check the bot can see that channel, send messages and add reactions, and that the emoji exists.");
  }
  return c.redirect("/coach/discord?done=1");
});

coachRoutes.post("/discord/mapping/:id/delete", async (c) => {
  await deleteMapping(Number(c.req.param("id")));
  return c.redirect("/coach/discord");
});
