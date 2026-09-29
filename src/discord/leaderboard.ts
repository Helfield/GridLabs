import { createHash } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { db } from "../db/client";
import { discordLeaderboardPosts } from "../db/schema";
import {
  getTrackBoard,
  listTracksWithLaps,
  classDisplayName,
  formatLapTime,
  LEADERBOARD_SIZE,
  type TrackBoard,
} from "../db/leaderboard";

/**
 * The Discord leaderboard channel.
 *
 * One message per track, posted through a channel webhook and then
 * EDITED in place whenever that track's board changes, so the channel
 * reads as a fixed set of boards rather than a scrolling log. Each
 * message is an embed with one field per car class -- the top
 * LEADERBOARD_SIZE drivers in that class, fastest first. When a class's
 * leader changes, a short announcement is posted too, so the channel
 * still has a pulse.
 *
 * Configured entirely by DISCORD_LEADERBOARD_WEBHOOK_URL (Railway ->
 * Variables). Unset means the whole thing is off and every call here
 * returns immediately -- nothing else in the site depends on it.
 *
 * Failures never propagate to the upload that triggered them: the
 * desktop app's session upload must succeed whether or not Discord is
 * reachable. Callers fire-and-forget syncTrackLeaderboard() and log.
 */

const COLOUR = 0xb14bff; // theme "fastest" purple
const MEDALS = ["🥇", "🥈", "🥉"];

type Leader = { userId: number; name: string; lapTimeSeconds: number };
type Leaders = Record<string, Leader>;

function webhookUrl(): string | null {
  const url = process.env.DISCORD_LEADERBOARD_WEBHOOK_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export function leaderboardEnabled(): boolean {
  return webhookUrl() !== null;
}

// ---------------------------------------------------------------- sync

// One sync at a time per track: two laps uploaded a second apart would
// otherwise race to post, and the loser's edit would land on a message
// the winner had just replaced.
const inflight = new Map<string, Promise<void>>();

export function syncTrackLeaderboard(track: string): Promise<void> {
  if (!leaderboardEnabled()) return Promise.resolve();
  const previous = inflight.get(track) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => syncOne(track))
    .finally(() => {
      if (inflight.get(track) === next) inflight.delete(track);
    });
  inflight.set(track, next);
  return next;
}

/** Every track with laps, in turn. Used at startup and by the coach's re-post button. */
export async function syncAllLeaderboards(): Promise<{ enabled: boolean; tracks: number }> {
  if (!leaderboardEnabled()) return { enabled: false, tracks: 0 };
  const tracks = await listTracksWithLaps();
  for (const track of tracks) {
    await syncTrackLeaderboard(track);
  }
  return { enabled: true, tracks: tracks.length };
}

async function syncOne(track: string): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  await ensureTable();

  const board = await getTrackBoard(track);
  const embed = renderEmbed(board);
  const hash = hashOf(embed);
  const leaders = leadersOf(board);

  const existing = await db.query.discordLeaderboardPosts.findFirst({
    where: eq(discordLeaderboardPosts.track, track),
  });
  if (existing && existing.contentHash === hash) return;

  let messageId = existing?.messageId ?? null;
  if (messageId) {
    // A deleted message comes back 404 -- post afresh rather than give up.
    const edited = await editMessage(url, messageId, embed);
    if (!edited) messageId = null;
  }
  if (!messageId) {
    messageId = await postMessage(url, { embeds: [embed] });
  }

  const now = new Date();
  await db
    .insert(discordLeaderboardPosts)
    .values({ track, messageId, contentHash: hash, leaders, updatedAt: now })
    .onConflictDoUpdate({
      target: discordLeaderboardPosts.track,
      set: { messageId, contentHash: hash, leaders, updatedAt: now },
    });

  // New leader in a class? Only once the board has been up before --
  // the first post of a track isn't "news", and neither is a re-post.
  if (existing) {
    const before = (existing.leaders ?? {}) as Leaders;
    for (const [cls, leader] of Object.entries(leaders)) {
      const prev = before[cls];
      const changed = !prev || prev.userId !== leader.userId || leader.lapTimeSeconds < prev.lapTimeSeconds - 0.0005;
      if (!changed) continue;
      const beaten = prev
        ? ` — beats ${escapeMd(prev.name)}'s \`${formatLapTime(prev.lapTimeSeconds)}\` by ${(prev.lapTimeSeconds - leader.lapTimeSeconds).toFixed(3)}s`
        : "";
      await postMessage(url, {
        content: `🏆 **New fastest ${classDisplayName(cls)} lap at ${escapeMd(track)}:** \`${formatLapTime(leader.lapTimeSeconds)}\` by **${escapeMd(leader.name)}**${beaten}`,
      });
    }
  }
}

// ------------------------------------------------------------ rendering

function renderEmbed(board: TrackBoard) {
  const fields = board.classes.map((c) => {
    const best = c.rows[0]?.lapTimeSeconds ?? 0;
    const lines = c.rows.map((r, i) => {
      const place = MEDALS[i] ?? `**${i + 1}.**`;
      const gap = i === 0 ? "" : `  _+${(r.lapTimeSeconds - best).toFixed(3)}_`;
      return `${place} \`${formatLapTime(r.lapTimeSeconds)}\`  ${escapeMd(r.name)}${gap}`;
    });
    return { name: classDisplayName(c.carClass), value: lines.join("\n").slice(0, 1024), inline: false };
  });

  return {
    title: `🏁 ${board.track}`.slice(0, 256),
    description: board.classes.length
      ? `Fastest valid lap per driver, top ${LEADERBOARD_SIZE} in each class.`
      : "No valid laps uploaded for this track yet.",
    color: COLOUR,
    fields: fields.slice(0, 25),
    footer: { text: "Grid Labs · updates itself when a faster lap is uploaded" },
  };
}

function leadersOf(board: TrackBoard): Leaders {
  const out: Leaders = {};
  for (const c of board.classes) {
    const top = c.rows[0];
    if (top) out[c.carClass] = { userId: top.userId, name: top.name, lapTimeSeconds: top.lapTimeSeconds };
  }
  return out;
}

function hashOf(embed: unknown): string {
  return createHash("sha256").update(JSON.stringify(embed)).digest("hex");
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

const JSON_HEADERS = { "Content-Type": "application/json" };

async function postMessage(url: string, body: { content?: string; embeds?: unknown[] }): Promise<string> {
  const res = await discordFetch(`${url}?wait=true`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...body, allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) throw new Error(`Discord webhook POST failed: ${res.status} ${await res.text()}`);
  const message = (await res.json()) as { id: string };
  return String(message.id);
}

async function editMessage(url: string, messageId: string, embed: unknown): Promise<boolean> {
  const res = await discordFetch(`${url}/messages/${messageId}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Discord webhook PATCH failed: ${res.status} ${await res.text()}`);
  return true;
}

// ----------------------------------------------------------------- table

// Safety net for a deploy where drizzle/0003 hasn't been applied yet:
// the table is tiny and self-contained, so creating it on first use
// costs nothing and means the leaderboard works the moment the webhook
// variable is set. Identical DDL to the migration; IF NOT EXISTS on
// both sides so whichever runs second is a no-op.
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
