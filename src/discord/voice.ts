import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { tempVoiceChannels } from "../db/schema";
import { botFetch, DiscordApiError, guildId } from "./bot-api";
import { getSetting } from "./settings";

/**
 * Join-to-create voice channels.
 *
 * A member joins the "lobby" voice channel (chosen on /coach/discord); the bot
 * makes them a voice channel of their own next to it, gives them Manage Channel
 * on that one channel (so they can rename it in Discord's own UI), and moves
 * them in. When a channel the bot made has had nobody in it for 30 seconds, it
 * is deleted.
 *
 * Who is in which channel comes from VOICE_STATE_UPDATE events (plus the
 * snapshot in GUILD_CREATE), kept in memory: Discord has no call that lists a
 * voice channel's members.
 */

export const LOBBY_SETTING = "voice_lobby";
const EMPTY_DELAY_MS = 30_000;
const MANAGE_CHANNELS = "16"; // permission bit 1 << 4, as the API wants it (a string)

export type VoiceState = {
  user_id: string;
  channel_id: string | null;
  guild_id?: string;
  member?: { nick?: string | null; user?: { username?: string; global_name?: string | null } };
};

const occupants = new Map<string, Set<string>>(); // channelId -> user ids
const timers = new Map<string, ReturnType<typeof setTimeout>>(); // channelId -> pending delete
const creating = new Set<string>(); // user ids with a channel being made right now

function occupantCount(channelId: string): number {
  return occupants.get(channelId)?.size ?? 0;
}

async function isTracked(channelId: string): Promise<boolean> {
  const [row] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId)).limit(1);
  return Boolean(row);
}

function cancelDelete(channelId: string): void {
  const t = timers.get(channelId);
  if (t) clearTimeout(t);
  timers.delete(channelId);
}

/** Deletes a bot-made channel in 30s unless someone is in it by then. */
async function scheduleDelete(channelId: string): Promise<void> {
  if (timers.has(channelId) || !(await isTracked(channelId))) return;
  timers.set(
    channelId,
    setTimeout(() => {
      timers.delete(channelId);
      deleteIfEmpty(channelId).catch((err) => console.error("Voice channel cleanup failed:", err));
    }, EMPTY_DELAY_MS),
  );
}

async function deleteIfEmpty(channelId: string): Promise<void> {
  if (occupantCount(channelId) > 0) return; // someone came back
  await botFetch("DELETE", `/channels/${channelId}`).catch((err) => {
    // Already gone (someone deleted it by hand) is the outcome we wanted anyway.
    if (!(err instanceof DiscordApiError && err.status === 404)) throw err;
  });
  occupants.delete(channelId);
  await db.delete(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, channelId));
}

function displayName(vs: VoiceState): string {
  return vs.member?.nick || vs.member?.user?.global_name || vs.member?.user?.username || "Driver";
}

/** The snapshot Discord sends when the bot connects: rebuilds who is where and sweeps leftovers. */
export async function onGuildCreate(guild: {
  id: string;
  channels?: Array<{ id: string }>;
  voice_states?: Array<{ user_id: string; channel_id: string | null }>;
}): Promise<void> {
  if (guild.id !== guildId()) return;
  occupants.clear();
  for (const vs of guild.voice_states ?? []) {
    if (!vs.channel_id) continue;
    const set = occupants.get(vs.channel_id) ?? new Set<string>();
    set.add(vs.user_id);
    occupants.set(vs.channel_id, set);
  }
  const live = new Set((guild.channels ?? []).map((c) => c.id));
  for (const row of await db.select().from(tempVoiceChannels)) {
    if (!live.has(row.channelId)) {
      await db.delete(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, row.channelId)); // deleted by hand
    } else if (occupantCount(row.channelId) === 0) {
      await scheduleDelete(row.channelId); // emptied while the bot was away
    }
  }
}

export async function onVoiceState(vs: VoiceState): Promise<void> {
  if (vs.guild_id && vs.guild_id !== guildId()) return;

  // Move the user in our picture of the server.
  let left: string | null = null;
  for (const [channelId, set] of occupants) {
    if (set.delete(vs.user_id)) {
      left = channelId;
      if (set.size === 0) occupants.delete(channelId);
    }
  }
  if (vs.channel_id) {
    const set = occupants.get(vs.channel_id) ?? new Set<string>();
    set.add(vs.user_id);
    occupants.set(vs.channel_id, set);
    cancelDelete(vs.channel_id);
  }
  // A mute or deafen re-sends the state with the same channel: nothing moved.
  if (left && left !== vs.channel_id && occupantCount(left) === 0) await scheduleDelete(left);

  if (vs.channel_id && vs.channel_id === (await getSetting(LOBBY_SETTING))) await createFor(vs);
}

async function createFor(vs: VoiceState): Promise<void> {
  const userId = vs.user_id;
  const lobbyId = vs.channel_id;
  if (!lobbyId || creating.has(userId)) return;
  creating.add(userId);
  try {
    // One channel each: coming back to the lobby returns you to the one you already own.
    const [owned] = await db.select().from(tempVoiceChannels).where(eq(tempVoiceChannels.ownerId, userId)).limit(1);
    if (owned) {
      const moved = await moveMember(userId, owned.channelId);
      if (moved) return;
      await db.delete(tempVoiceChannels).where(eq(tempVoiceChannels.channelId, owned.channelId)); // gone; make a new one
    }

    const lobby = await botFetch<{ parent_id?: string | null }>("GET", `/channels/${lobbyId}`);
    const channel = await botFetch<{ id: string }>("POST", `/guilds/${guildId()}/channels`, {
      name: `${displayName(vs)}'s channel`.slice(0, 100),
      type: 2,
      parent_id: lobby?.parent_id ?? undefined,
      // Manage Channel on this one channel lets the owner rename it from Discord's own settings.
      permission_overwrites: [{ id: userId, type: 1, allow: MANAGE_CHANNELS }],
    });
    if (!channel) return;
    await db.insert(tempVoiceChannels).values({ channelId: channel.id, ownerId: userId });
    // If the member never makes it in (left the lobby first), the channel goes after 30s like any empty one.
    await scheduleDelete(channel.id);
    await moveMember(userId, channel.id);
  } finally {
    creating.delete(userId);
  }
}

/** Moves a member into a voice channel; false if Discord says they can't be (left voice, channel gone). */
async function moveMember(userId: string, channelId: string): Promise<boolean> {
  try {
    await botFetch("PATCH", `/guilds/${guildId()}/members/${userId}`, { channel_id: channelId });
    return true;
  } catch (err) {
    if (err instanceof DiscordApiError && (err.status === 404 || err.status === 400)) return false;
    throw err;
  }
}
