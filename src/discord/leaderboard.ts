import { createHash } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db } from "../db/client";
import { discordLeaderboardPosts } from "../db/schema";
import { getTrackBoard, listTracksWithLaps, formatLapTime, type TrackBoard } from "../db/leaderboard";
import { classDisplayName } from "../classes";
import { renderBoardPng, type BoardTrack } from "./board-image";

/**
 * The Discord leaderboard channel.
 *
 * ONE message: a designed picture of the fastest valid lap in every car
 * class on every track (board-image.ts), posted through a channel
 * webhook and EDITED IN PLACE whenever the records change. It never
 * moves and never multiplies -- the channel stays a single board.
 *
 * Below it, a one-line announcement goes out only when a record is
 * actually beaten ("New fastest GT3 lap at Monza ... beats X's time by
 * 0.435s"). A record appearing for the first time, or a lap coming off
 * the board because it was disqualified, is not announced -- the board
 * just updates.
 *
 * Configured entirely by DISCORD_LEADERBOARD_WEBHOOK_URL (Railway ->
 * Variables). Unset means the whole thing is off and every call here
 * returns immediately -- nothing else in the site depends on it. If
 * the image can't be drawn for any reason, the same records are posted
 * as a text embed instead, so the board still updates.
 *
 * Failures never propagate to whatever triggered them: an upload must
 * succeed whether or not Discord is reachable. Callers fire-and-forget
 * syncTrackLeaderboard() and log.
 */

const SITE_URL = (process.env.SITE_URL ?? "https://gridlabs.com").replace(/\/+$/, "");
const COLOUR = 0xb14bff; // theme "fastest" purple

// Bump when the picture's design changes, so the board is redrawn once
// even though the records themselves haven't.
const BOARD_DESIGN = 1;

// The one row in discord_leaderboard_posts that belongs to the board.
// (The table used to hold a row per track, one message each; any of
// those still there are cleaned up on the first run -- see publish().)
const BOARD_KEY = "__board__";

// One row per track+class holding the id of its latest "new fastest lap"
// announcement, so the next one can replace it instead of piling up when
// someone is stringing together records. Keyed `__ann__:<track>||<class>`.
const ANN_PREFIX = "__ann__:";

type Leader = { userId: number; name: string; lapTimeSeconds: number };
type Leaders = Record<string, Leader>; // key: `${track}||${class}`

function webhookUrl(): string | null {
  const url = process.env.DISCORD_LEADERBOARD_WEBHOOK_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export function leaderboardEnabled(): boolean {
  return webhookUrl() !== null;
}

// ---------------------------------------------------------------- state

// The current record-holders for every track, kept in memory so an
// upload only has to recompute the track it touched. Filled on first
// use (or by a full sync) -- never partially: a board drawn from a
// half-filled cache would drop tracks.
let boards: Map<string, TrackBoard> | null = null;

async function loadAll(): Promise<void> {
  const next = new Map<string, TrackBoard>();
  for (const track of await listTracksWithLaps()) {
    const board = await getTrackBoard(track, 1);
    if (board.classes.length) next.set(track, board);
  }
  boards = next;
}

async function refreshTrack(track: string): Promise<void> {
  if (!boards) return loadAll();
  const board = await getTrackBoard(track, 1);
  if (board.classes.length) boards.set(track, board);
  else boards.delete(track);
}

// One update at a time: two laps uploaded a second apart would
// otherwise race to edit the same message.
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.catch(() => undefined).then(work);
  chain = run;
  return run;
}

// ----------------------------------------------------------- public API

/**
 * A track's records may have changed (a lap uploaded, disqualified or
 * restored). `announce: false` updates the board without announcing a
 * beaten record -- for a coach's correction (disqualifying or restoring
 * a lap), which changes who holds a record but isn't a time being beaten.
 */
export function syncTrackLeaderboard(track: string, options: { announce?: boolean } = {}): Promise<void> {
  if (!leaderboardEnabled()) return Promise.resolve();
  return enqueue(async () => {
    await refreshTrack(track);
    await publish(false, options.announce !== false);
  });
}

/**
 * Recompute everything from the database. Used at startup (repost false:
 * edit the existing board if anything changed) and by the coach's
 * button (repost true: delete the board and post it afresh, which also
 * moves it to the bottom of the channel and repairs a message deleted
 * by hand).
 */
export function syncAllLeaderboards(options: { repost?: boolean } = {}): Promise<{ enabled: boolean; tracks: number }> {
  if (!leaderboardEnabled()) return Promise.resolve({ enabled: false, tracks: 0 });
  return enqueue(async () => {
    await loadAll();
    await publish(options.repost === true);
    return { enabled: true, tracks: boards?.size ?? 0 };
  });
}

// -------------------------------------------------------------- publish

async function publish(repost: boolean, announce = true): Promise<void> {
  const url = webhookUrl();
  if (!url || !boards) return;
  await ensureTable();

  const tracks = boardTracks();
  const leaders = leadersOf();
  const hash = createHash("sha256").update(JSON.stringify({ design: BOARD_DESIGN, tracks })).digest("hex");

  const rows = await db.query.discordLeaderboardPosts.findMany();
  const board = rows.find((r) => r.track === BOARD_KEY);
  const announcements = new Map(rows.filter((r) => r.track.startsWith(ANN_PREFIX)).map((r) => [r.track, r]));
  const legacy = rows.filter((r) => r.track !== BOARD_KEY && !r.track.startsWith(ANN_PREFIX));

  // What the records were before this update, to spot a beaten one. The
  // first run after the move from one-message-per-track has no board row
  // yet, so it borrows the old rows' leaders -- otherwise every record
  // on the board would be announced as new.
  const before: Leaders | null = board ? ((board.leaders ?? {}) as Leaders) : legacy.length ? legacyLeaders(legacy) : null;

  const unchanged = !!board && board.contentHash === hash && !repost;
  if (!unchanged) {
    const now = new Date();
    let messageId = board?.messageId ?? null;

    if (repost && messageId) {
      await deleteMessage(url, messageId).catch(() => undefined);
      messageId = null;
    }

    const image = await draw(tracks, now);
    const payload = boardPayload(tracks, now, image !== null);
    if (messageId) {
      const edited = await send("PATCH", `${url}/messages/${messageId}`, payload, image);
      if (edited === null) messageId = null; // deleted by hand: post afresh
    }
    if (!messageId) {
      const posted = await send("POST", `${url}?wait=true`, payload, image);
      if (posted === null) throw new Error("Discord webhook POST returned nothing");
      messageId = posted;
    }

    await db
      .insert(discordLeaderboardPosts)
      .values({ track: BOARD_KEY, messageId, contentHash: hash, leaders, updatedAt: now })
      .onConflictDoUpdate({
        target: discordLeaderboardPosts.track,
        set: { messageId, contentHash: hash, leaders, updatedAt: now },
      });
  }

  // The old one-message-per-track boards (and the stray "Unknown Track"
  // one): delete their messages and forget them. Runs after the new
  // board exists, so the channel is never empty in between.
  for (const old of legacy) {
    await deleteMessage(url, old.messageId).catch((err) =>
      console.error(`Couldn't delete the old ${old.track} leaderboard message:`, err),
    );
    await db.delete(discordLeaderboardPosts).where(eq(discordLeaderboardPosts.track, old.track));
  }

  // Announce records that were beaten -- and only those.
  if (announce && !unchanged && before) {
    for (const [key, now] of Object.entries(leaders)) {
      const prev = before[key];
      if (!prev || now.lapTimeSeconds >= prev.lapTimeSeconds - 0.0005) continue;
      const [track, cls] = key.split("||");
      const own = prev.userId === now.userId;
      const beaten = own
        ? ` — beats their own \`${formatLapTime(prev.lapTimeSeconds)}\` by ${(prev.lapTimeSeconds - now.lapTimeSeconds).toFixed(3)}s`
        : ` — beats ${escapeMd(prev.name)}'s \`${formatLapTime(prev.lapTimeSeconds)}\` by ${(prev.lapTimeSeconds - now.lapTimeSeconds).toFixed(3)}s`;
      const posted = await send(
        "POST",
        `${url}?wait=true`,
        {
          content: `🏆 **New fastest ${classDisplayName(cls)} lap at ${escapeMd(track)}:** \`${formatLapTime(now.lapTimeSeconds)}\` by **${escapeMd(now.name)}**${beaten}`,
          allowed_mentions: { parse: [] },
        },
        null,
      );

      // Replace, don't stack: the previous announcement for this same
      // track and class is now out of date (its record has just been
      // beaten), so take it down. New first, old second, as with the board.
      const annKey = ANN_PREFIX + key;
      const previous = announcements.get(annKey);
      if (previous) {
        await deleteMessage(url, previous.messageId).catch((err) =>
          console.error(`Couldn't delete the previous announcement for ${track} ${cls}:`, err),
        );
      }
      if (posted) {
        const stamp = new Date();
        await db
          .insert(discordLeaderboardPosts)
          .values({ track: annKey, messageId: posted, contentHash: null, leaders: null, updatedAt: stamp })
          .onConflictDoUpdate({
            target: discordLeaderboardPosts.track,
            set: { messageId: posted, updatedAt: stamp },
          });
      }
    }
  }
}

// ----------------------------------------------------------- the board

function boardTracks(): BoardTrack[] {
  return [...(boards ?? new Map<string, TrackBoard>()).values()]
    .sort((a, b) => a.track.localeCompare(b.track))
    .map((b) => ({
      track: b.track,
      rows: b.classes.map((c) => ({
        classKey: c.carClass,
        classLabel: classDisplayName(c.carClass),
        time: formatLapTime(c.rows[0].lapTimeSeconds),
        driver: c.rows[0].name,
      })),
    }));
}

function leadersOf(): Leaders {
  const out: Leaders = {};
  for (const board of boards?.values() ?? []) {
    for (const c of board.classes) {
      const top = c.rows[0];
      if (top) out[`${board.track}||${c.carClass}`] = { userId: top.userId, name: top.name, lapTimeSeconds: top.lapTimeSeconds };
    }
  }
  return out;
}

/** Leaders as the old per-track rows recorded them (keyed by class only). */
function legacyLeaders(rows: Array<{ track: string; leaders: unknown }>): Leaders {
  const out: Leaders = {};
  for (const row of rows) {
    for (const [cls, leader] of Object.entries((row.leaders ?? {}) as Record<string, Leader>)) {
      out[`${row.track}||${cls}`] = leader;
    }
  }
  return out;
}

/** The picture, or null if it can't be drawn (the text board is used instead). */
async function draw(tracks: BoardTrack[], at: Date): Promise<{ filename: string; data: Uint8Array; alt: string } | null> {
  try {
    const data = await renderBoardPng(tracks, at);
    const alt = tracks
      .map((t) => `${t.track}: ${t.rows.map((r) => `${r.classLabel} ${r.time} ${r.driver}`).join(", ")}`)
      .join("; ")
      .slice(0, 1000);
    // A fresh name each time, so no client shows a cached older picture.
    return { filename: `fastest-laps-${at.getTime()}.png`, data, alt };
  } catch (err) {
    console.error("Leaderboard image failed; posting the text board instead:", err);
    return null;
  }
}

function boardPayload(tracks: BoardTrack[], at: Date, hasImage: boolean): Record<string, unknown> {
  const unix = Math.floor(at.getTime() / 1000);
  const content =
    `🏁 **Fastest laps** · updated <t:${unix}:R> · full times & downloads: <${SITE_URL}/library>`;
  if (hasImage) {
    return { content, embeds: [], allowed_mentions: { parse: [] } };
  }
  // Text fallback: the same records as an embed (Discord allows 4096 characters of description).
  const description = tracks
    .map((t) => `**${escapeMd(t.track)}**\n` + t.rows.map((r) => `\`${r.classLabel.padEnd(11)}\` \`${r.time}\`  ${escapeMd(r.driver)}`).join("\n"))
    .join("\n\n")
    .slice(0, 4000);
  return {
    content,
    embeds: [{ title: "🏁 Fastest laps", description: description || "No valid laps yet.", color: COLOUR }],
    attachments: [],
    allowed_mentions: { parse: [] },
  };
}

function escapeMd(text: string): string {
  return text.replace(/([\\*_~`|>#-])/g, "\\$1");
}

// -------------------------------------------------------------- webhook

async function discordFetch(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init);
  if (res.status === 429) {
    // One polite retry after the wait Discord asks for.
    const body = (await res.json().catch(() => null)) as { retry_after?: number } | null;
    await new Promise((r) => setTimeout(r, Math.min(10, body?.retry_after ?? 1) * 1000));
    res = await fetch(url, init);
  }
  return res;
}

/**
 * POST or PATCH a message, with the picture attached as a file when
 * there is one. Returns the message id, or null for a 404 on PATCH (the
 * message no longer exists). An edit lists only the new attachment, which
 * is what replaces the old picture.
 */
async function send(
  method: "POST" | "PATCH",
  url: string,
  payload: Record<string, unknown>,
  image: { filename: string; data: Uint8Array; alt: string } | null,
): Promise<string | null> {
  let init: RequestInit;
  if (image) {
    const form = new FormData();
    form.append(
      "payload_json",
      JSON.stringify({ ...payload, attachments: [{ id: 0, filename: image.filename, description: image.alt }] }),
    );
    form.append("files[0]", new Blob([new Uint8Array(image.data)], { type: "image/png" }), image.filename);
    init = { method, body: form };
  } else {
    init = { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
  }

  const res = await discordFetch(url, init);
  if (method === "PATCH" && res.status === 404) return null;
  if (!res.ok) throw new Error(`Discord webhook ${method} failed: ${res.status} ${await res.text()}`);
  const message = (await res.json().catch(() => null)) as { id?: string } | null;
  return message?.id ? String(message.id) : "";
}

/** Already gone (404) counts as deleted. */
async function deleteMessage(url: string, messageId: string): Promise<void> {
  const res = await discordFetch(`${url}/messages/${messageId}`, { method: "DELETE" });
  if (res.status === 404 || res.status === 204) return;
  if (!res.ok) throw new Error(`Discord webhook DELETE failed: ${res.status} ${await res.text()}`);
}

// ----------------------------------------------------------------- table

// Safety net for a deploy where drizzle/0003 hasn't been applied yet:
// the table is tiny and self-contained, so creating it on first use
// costs nothing. Identical DDL to the migration; IF NOT EXISTS on both
// sides so whichever runs second is a no-op.
let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = db
      .execute(
        sql`CREATE TABLE IF NOT EXISTS "discord_leaderboard_posts" (
          "track" text PRIMARY KEY NOT NULL,
          "message_id" text NOT NULL,
          "content_hash" text,
          "leaders" jsonb,
          "updated_at" timestamp DEFAULT now() NOT NULL
        )`,
      )
      .then(() => undefined)
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  return tableReady;
}
