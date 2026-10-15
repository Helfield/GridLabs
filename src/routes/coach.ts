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
import { discordEditPage, discordPage } from "../views/coach-discord";
import { botEnabled, botFetch, DiscordApiError, guildId, listAssignableRoles, listChannelsByKind, listGuildEmojis, listTextChannels, parseEmoji } from "../discord/bot-api";
import { clearSetting, getSetting, setSetting } from "../discord/settings";
import { LOBBY_SETTING } from "../discord/voice";
import { attachToMessage, createPanel, deleteMapping, deleteMessageMappings, emojisOnMessage, getPanel, listReactionRoles, mappingsForMessage, MAX_REACTIONS_PER_MESSAGE, syncMessage, type RolePair } from "../discord/reaction-roles";

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
  let kinds: Awaited<ReturnType<typeof listChannelsByKind>> = { text: [], voice: [], categories: [] };
  let emojis: Awaited<ReturnType<typeof listGuildEmojis>> = [];
  if (enabled) {
    try {
      [roles, kinds, emojis] = await Promise.all([listAssignableRoles(), listChannelsByKind(), listGuildEmojis()]);
    } catch (err) {
      console.error("Loading Discord roles/channels failed:", err);
      error = "Couldn't load the server's roles and channels. Is the bot invited to the server and is DISCORD_GUILD_ID right?";
    }
  }
  const notice = c.req.query("done") ? "Done — the reaction roles are live." : null;
  error = c.req.query("error") ?? error;
  return c.html(
    discordPage(user, { enabled, guildId: guildId(), notice, error, mappings: await listReactionRoles(),
    roles,
    channels: kinds.text,
    emojis,
    voice: {
      lobbyId: await getSetting(LOBBY_SETTING),
      voiceChannels: kinds.voice,
      categories: kinds.categories,
      notice: c.req.query("voice") ?? null,
    },
  }),
  );
});

type FormBody = Record<string, string | File | (string | File)[]>;

/** The emoji/role rows of a reaction-role form, checked against the server's real roles and emoji. */
async function readPairs(body: FormBody): Promise<{ pairs: RolePair[] } | { error: string }> {
  const one = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const many = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(one);
  // Only roles the page offers, so a hand-built request can't hand out a role it never showed.
  const [roles, customEmojis] = await Promise.all([listAssignableRoles(), listGuildEmojis()]);
  const emojis = many(body.emoji);
  const roleIds = many(body.roleId);
  const pairs: RolePair[] = [];
  for (let i = 0; i < emojis.length; i++) {
    if (!emojis[i] && !roleIds[i]) continue;
    const emoji = parseEmoji(emojis[i] ?? "", customEmojis);
    const role = roles.find((r) => r.id === roleIds[i]);
    if (!emoji || !role) return { error: `Row ${i + 1}: needs a real emoji and a role.` };
    if (pairs.some((p) => p.emoji === emoji)) return { error: `Row ${i + 1}: that emoji is already used.` };
    pairs.push({ emoji, roleId: role.id, roleName: role.name });
  }
  if (pairs.length === 0) return { error: "Add at least one emoji and role." };
  return { pairs };
}

/** Discord's own reason for a refusal ("Missing Access", "Unknown Emoji", ...). */
function discordReason(err: unknown): string {
  if (!(err instanceof DiscordApiError)) return "";
  try {
    return (JSON.parse(err.body) as { message?: string }).message ?? "";
  } catch {
    return "";
  }
}

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

  const read = await readPairs(body);
  if ("error" in read) return fail(read.error);
  const pairs = read.pairs;
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
    const reason = discordReason(err);
    return fail(
      `Discord refused${reason ? `: ${reason}` : ""}. Check the bot can see that channel, send messages and add reactions, and that the emoji exists.`,
    );
  }
  return c.redirect("/coach/discord?done=1");
});

coachRoutes.post("/discord/mapping/:id/delete", async (c) => {
  await deleteMapping(Number(c.req.param("id")));
  return c.redirect("/coach/discord");
});

// Edit one live message in place: its pairs are shown filled in and Save makes
// the message's reaction roles exactly what was submitted.
async function editPage(c: any, messageId: string, extra: { error?: string | null; notice?: string | null } = {}) {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  const rows = await mappingsForMessage(messageId);
  if (rows.length === 0) return c.redirect("/coach/discord?error=" + encodeURIComponent("That message has no reaction roles."));
  const enabled = botEnabled();
  let roles: Awaited<ReturnType<typeof listAssignableRoles>> = [];
  let channels: Awaited<ReturnType<typeof listTextChannels>> = [];
  let emojis: Awaited<ReturnType<typeof listGuildEmojis>> = [];
  let error = extra.error ?? null;
  if (enabled) {
    try {
      [roles, channels, emojis] = await Promise.all([listAssignableRoles(), listTextChannels(), listGuildEmojis()]);
    } catch (err) {
      console.error("Loading Discord roles/channels failed:", err);
      error = error ?? "Couldn't load the server's roles and channels.";
    }
  }
  const panel = await getPanel(messageId);
  return c.html(
    discordEditPage(user, {
      enabled,
      guildId: guildId(),
      channelId: rows[0].channelId,
      channelName: channels.find((ch) => ch.id === rows[0].channelId)?.name ?? null,
      messageId,
      text: panel ? panel.text : null,
      rows: rows.map((r) => ({ emoji: r.emoji, roleId: r.roleId })),
      roles,
      emojis,
      error,
      notice: extra.notice ?? null,
    }),
  );
}

coachRoutes.get("/discord/message/:messageId", async (c) => {
  const messageId = c.req.param("messageId");
  if (!/^\d+$/.test(messageId)) return c.redirect("/coach/discord");
  return editPage(c, messageId, { notice: c.req.query("saved") ? "Saved." : null });
});

coachRoutes.post("/discord/message/:messageId", async (c) => {
  const messageId = c.req.param("messageId");
  if (!/^\d+$/.test(messageId)) return c.redirect("/coach/discord");
  if (!botEnabled()) return editPage(c, messageId, { error: "The bot is off." });
  const body = (await c.req.parseBody({ all: true })) as FormBody;
  const read = await readPairs(body);
  if ("error" in read) return editPage(c, messageId, { error: read.error });
  if (read.pairs.length > MAX_REACTIONS_PER_MESSAGE) {
    return editPage(c, messageId, { error: `Discord allows ${MAX_REACTIONS_PER_MESSAGE} reactions per message.` });
  }
  const text = typeof body.text === "string" ? body.text.trim() : undefined;
  try {
    await syncMessage(messageId, read.pairs, text);
  } catch (err) {
    console.error("Saving reaction roles failed:", err);
    const reason = discordReason(err);
    return editPage(c, messageId, {
      error: `Discord refused${reason ? `: ${reason}` : ""}. Some changes may have been saved — the list below shows what is live.`,
    });
  }
  return c.redirect(`/coach/discord/message/${messageId}?saved=1`);
});

coachRoutes.post("/discord/message/:messageId/delete", async (c) => {
  const messageId = c.req.param("messageId");
  if (/^\d+$/.test(messageId)) await deleteMessageMappings(messageId);
  return c.redirect("/coach/discord");
});

// Temporary voice channels: which voice channel is the join-to-create lobby.
// The bot's side of it runs from discord/voice.ts.
coachRoutes.post("/discord/voice", async (c) => {
  const body = await c.req.parseBody();
  const one = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const done = (msg: string) => c.redirect(`/coach/discord?voice=${encodeURIComponent(msg)}`);
  const fail = (msg: string) => c.redirect(`/coach/discord?error=${encodeURIComponent(msg)}`);
  if (!botEnabled()) return fail("The bot is off.");

  const action = one(body.action);
  if (action === "off") {
    await clearSetting(LOBBY_SETTING);
    return done("Temporary voice channels are off. Channels already made will still close when empty.");
  }
  if (action === "set") {
    const channelId = one(body.channelId);
    // Only a voice channel the server really has, so a hand-built request can't point the lobby at a text channel.
    const { voice } = await listChannelsByKind();
    if (!voice.some((v) => v.id === channelId)) return fail("Pick a voice channel from the list.");
    await setSetting(LOBBY_SETTING, channelId);
    return done("Lobby set. Joining it now creates a channel.");
  }
  if (action === "create") {
    const name = one(body.name).slice(0, 100) || "Create a channel";
    const categoryId = one(body.categoryId);
    if (categoryId && !/^\d+$/.test(categoryId)) return fail("Pick a category from the list.");
    try {
      const channel = await botFetch<{ id: string }>("POST", `/guilds/${guildId()}/channels`, {
        name,
        type: 2,
        parent_id: categoryId || undefined,
      });
      if (!channel) return fail("Discord returned no channel.");
      await setSetting(LOBBY_SETTING, channel.id);
    } catch (err) {
      console.error("Creating the voice lobby failed:", err);
      const reason = discordReason(err);
      return fail(`Discord refused${reason ? `: ${reason}` : ""}. The bot needs the Manage Channels permission.`);
    }
    return done("Lobby channel created. Joining it now creates a channel.");
  }
  return fail("Unknown action.");
});
