import { botEnabled, DiscordApiError, guildId } from "./bot-api";
import { findRoleFor, giveRole, memberRoleIds, otherChoicesOnMessage, removeMemberReaction, takeRole } from "./reaction-roles";
import { onGuildCreate, onVoiceState, type VoiceState } from "./voice";

/**
 * The bot's live connection to Discord, used for reaction roles: when a member
 * adds (or removes) a reaction on a message set up in /coach/discord, they get
 * (or lose) the matching role. One message is one choice, so adding a second
 * reaction moves them rather than stacking another role on top, and the click
 * they made earlier is taken off the message for them.
 *
 * It also drives join-to-create voice channels (voice.ts).
 *
 * A bare gateway client over Bun's built-in WebSocket -- like the rest of the
 * Discord code here there is no library. It needs the GUILDS, GUILD_VOICE_STATES and
 * GUILD_MESSAGE_REACTIONS intents, none of them privileged, so nothing has to be switched on in the
 * developer portal besides creating the bot. Off entirely unless
 * DISCORD_BOT_TOKEN is set.
 */

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const INTENT_GUILDS = 1 << 0; // delivers GUILD_CREATE: the channel list and who is already in voice
const INTENT_GUILD_VOICE_STATES = 1 << 7;
const INTENT_GUILD_MESSAGE_REACTIONS = 1 << 10;

type Payload = { op: number; d: any; s: number | null; t: string | null };
type ReactionEvent = {
  user_id: string;
  guild_id?: string;
  channel_id: string;
  message_id: string;
  emoji: { id: string | null; name: string | null };
  // Discord sends the member with a reaction event, but the field is optional,
  // so the role sweep below falls back to a REST call when it is missing.
  member?: { roles?: string[] };
};

let ws: WebSocket | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let seq: number | null = null;
let sessionId: string | null = null;
let resumeUrl: string | null = null;
let botUserId: string | null = null;
let ackReceived = true;

export function startBot(): void {
  if (!botEnabled()) {
    console.log("Discord bot: off (DISCORD_BOT_TOKEN not set).");
    return;
  }
  connect();
}

function connect(resume = false): void {
  const url = resume && resumeUrl ? `${resumeUrl}/?v=10&encoding=json` : GATEWAY_URL;
  const socket = new WebSocket(url);
  ws = socket;

  socket.onmessage = (event) => {
    let msg: Payload;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (msg.s !== null && msg.s !== undefined) seq = msg.s;
    handle(socket, msg, resume);
  };

  socket.onclose = (event) => {
    if (ws !== socket) return;
    stopHeartbeat();
    // 4004 = bad token, 4013/4014 = bad/disallowed intents: retrying can't help.
    if (event.code === 4004 || event.code === 4013 || event.code === 4014) {
      console.error(`Discord bot: gateway closed with ${event.code} (${event.reason}); not reconnecting.`);
      return;
    }
    console.warn(`Discord bot: gateway closed (${event.code}); reconnecting.`);
    const canResume = Boolean(sessionId) && event.code !== 4007 && event.code !== 4009;
    setTimeout(() => connect(canResume), 5000);
  };

  socket.onerror = () => {
    // onclose follows and handles the retry.
  };
}

function send(socket: WebSocket, op: number, d: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op, d }));
}

function stopHeartbeat(): void {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

function handle(socket: WebSocket, msg: Payload, resuming: boolean): void {
  switch (msg.op) {
    case 10: {
      // HELLO: start heartbeating, then identify or resume.
      const interval = msg.d.heartbeat_interval as number;
      stopHeartbeat();
      ackReceived = true;
      setTimeout(() => send(socket, 1, seq), interval * Math.random());
      heartbeat = setInterval(() => {
        if (!ackReceived) {
          // Zombie connection: Discord stopped answering. Close and resume.
          socket.close(4000, "no heartbeat ack");
          return;
        }
        ackReceived = false;
        send(socket, 1, seq);
      }, interval);
      const token = process.env.DISCORD_BOT_TOKEN;
      if (resuming && sessionId) {
        send(socket, 6, { token, session_id: sessionId, seq });
      } else {
        send(socket, 2, {
          token,
          intents: INTENT_GUILDS | INTENT_GUILD_VOICE_STATES | INTENT_GUILD_MESSAGE_REACTIONS,
          properties: { os: "linux", browser: "gridlabs", device: "gridlabs" },
        });
      }
      break;
    }
    case 11:
      ackReceived = true;
      break;
    case 1:
      send(socket, 1, seq);
      break;
    case 7:
      // RECONNECT: Discord asks us to come back (and resume).
      socket.close(4000, "reconnect requested");
      break;
    case 9:
      // INVALID SESSION: d says whether it is resumable; if not, start fresh.
      if (!msg.d) {
        sessionId = null;
        seq = null;
      }
      socket.close(msg.d ? 4000 : 4009, "invalid session");
      break;
    case 0:
      dispatch(msg.t, msg.d);
      break;
  }
}

function dispatch(type: string | null, data: any): void {
  switch (type) {
    case "READY":
      sessionId = data.session_id;
      resumeUrl = data.resume_gateway_url;
      botUserId = data.user.id;
      console.log(`Discord bot: connected as ${data.user.username}.`);
      break;
    case "GUILD_CREATE":
      onGuildCreate(data).catch((err) => console.error("Voice startup sweep failed:", err));
      break;
    case "VOICE_STATE_UPDATE":
      onVoiceState(data as VoiceState).catch((err) => console.error("Voice channel handling failed:", err));
      break;
    case "MESSAGE_REACTION_ADD":
      onReaction(data as ReactionEvent, true).catch((err) => console.error("Reaction role (add) failed:", err));
      break;
    case "MESSAGE_REACTION_REMOVE":
      onReaction(data as ReactionEvent, false).catch((err) => console.error("Reaction role (remove) failed:", err));
      break;
  }
}

async function onReaction(e: ReactionEvent, added: boolean): Promise<void> {
  if (e.guild_id !== guildId()) return;
  if (e.user_id === botUserId) return; // the bot's own seed reactions
  const emoji = e.emoji.id ? `${e.emoji.name}:${e.emoji.id}` : e.emoji.name;
  if (!emoji) return;
  const roleId = await findRoleFor(e.message_id, emoji);
  if (!roleId) return;
  if (!added) {
    // Un-clicking takes the role away again. A member can land here for a
    // reaction this handler already cleared, holding nothing to lose, so the
    // failure is not worth logging.
    await takeRole(e.user_id, roleId).catch(() => {});
    return;
  }
  await giveRole(e.user_id, roleId);
  // One message is one choice. Discord leaves the earlier reaction in place
  // when a member clicks a different emoji, so without this a driver moving
  // from Bronze 3 to Silver 2 keeps both roles and the lit-up Bronze 3 makes
  // the picker read as though it only worked the first time. Grant first, then
  // take the others off, so a failure here can never leave them with no band.
  const others = await otherChoicesOnMessage(e.message_id, roleId);
  if (others.length === 0) return;
  // The event's member object is the cheap way to learn what to take back off,
  // but it is a partial object: an empty list is treated as unknown and asked
  // for over REST, because believing one is how the sweep quietly does nothing
  // and the member keeps two bands.
  let held = e.member?.roles ?? [];
  if (held.length === 0) held = await memberRoleIds(e.user_id).catch(() => []);
  let cleared = 0;
  const problems: string[] = [];
  for (const other of others) {
    if (!held.includes(other.roleId)) continue;
    try {
      await takeRole(e.user_id, other.roleId);
    } catch (err) {
      problems.push(`removing ${other.roleName ?? other.roleId} failed: ${why(err)}`);
    }
    try {
      await removeMemberReaction(e.channel_id, e.message_id, other.emoji, e.user_id);
      cleared++;
    } catch (err) {
      // 404 means there was no click of theirs to clear, which is not a problem.
      if (!(err instanceof DiscordApiError) || err.status !== 404) problems.push(`clearing ${other.emoji} failed: ${why(err)}`);
    }
  }
  const line = `Discord: ${e.user_id} chose role ${roleId} on message ${e.message_id}, ${cleared} old click(s) cleared`;
  if (problems.length) console.error(`${line}. ${problems.join(" | ")}`);
  else console.log(line);
}

/** Discord's own words, trimmed to one line, with the permission named when it said no. */
function why(err: unknown): string {
  if (err instanceof DiscordApiError) {
    const hint = err.status === 403 ? " (the bot role needs Manage Roles, plus Manage Messages to clear a click)" : "";
    return `${err.status}${hint} ${err.body.slice(0, 140)}`;
  }
  return String(err);
}
