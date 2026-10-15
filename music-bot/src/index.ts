import { writeFileSync } from "node:fs";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type VoiceBasedChannel,
} from "discord.js";
import { denyControl } from "./ownership.ts";
import { GuildPlayer } from "./player.ts";
import { formatDuration, parseTarget } from "./target.ts";
import { COOKIES_FILE, YtdlpError, lookup } from "./ytdlp.ts";

/**
 * The GridLabs music bot: plays YouTube audio in a member's voice channel.
 *
 * This runs as its own service (see the Dockerfile) with the same bot token as
 * the website's bot. It only listens for slash commands and voice-state
 * changes; reaction roles and temporary voice channels stay with the website.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const TOKEN = requireEnv("DISCORD_BOT_TOKEN");
const GUILD_ID = requireEnv("DISCORD_GUILD_ID");
const DEFAULT_VOLUME = Math.min(100, Math.max(0, Number(process.env.DEFAULT_VOLUME ?? 50) || 50)) / 100;

// YouTube sometimes refuses servers until it sees a signed-in session. A cookies.txt, base64-encoded,
// in YT_COOKIES lets the bot present one. Optional.
if (process.env.YT_COOKIES) {
  writeFileSync(COOKIES_FILE, Buffer.from(process.env.YT_COOKIES, "base64"), { mode: 0o600 });
  console.log("YouTube cookies loaded.");
}

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a YouTube link (or search for a song) in your voice channel")
    .addStringOption((o) => o.setName("song").setDescription("A YouTube link, or words to search for").setRequired(true)),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current song"),
  new SlashCommandBuilder().setName("pause").setDescription("Pause the music"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume the music"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop the music, clear the queue and leave the channel"),
  new SlashCommandBuilder().setName("queue").setDescription("Show what is playing and what is next"),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set the music volume for everyone (it starts at 50%)")
    .addIntegerOption((o) => o.setName("percent").setDescription("0 to 100").setMinValue(0).setMaxValue(100).setRequired(true)),
].map((c) => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const players = new Map<string, GuildPlayer>();

function playerFor(guildId: string): GuildPlayer {
  let p = players.get(guildId);
  if (!p) {
    p = new GuildPlayer(guildId, DEFAULT_VOLUME, () => players.delete(guildId));
    players.set(guildId, p);
  }
  return p;
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Music bot: connected as ${c.user.tag}.`);
  try {
    await new REST().setToken(TOKEN).put(Routes.applicationGuildCommands(c.application.id, GUILD_ID), { body: commands });
    console.log("Music bot: slash commands registered.");
  } catch (err) {
    console.error(
      "Registering slash commands failed. Was the bot invited with the applications.commands scope? See music-bot/README.md.",
      err,
    );
  }
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = (newState.guild ?? oldState.guild).id;
  const p = players.get(guildId);
  if (!p?.channelId) return;
  if (oldState.channelId !== p.channelId && newState.channelId !== p.channelId) return;
  const channel = (newState.guild ?? oldState.guild).channels.cache.get(p.channelId);
  if (channel?.isVoiceBased()) p.checkChannel(channel.members.filter((m) => !m.user.bot).size);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handle(interaction);
  } catch (err) {
    console.error(`/${interaction.commandName} failed:`, err);
    const msg = "Something went wrong. Try again in a moment.";
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral } as const);

const CONTROL_COMMANDS = new Set(["skip", "pause", "resume", "stop", "volume"]);

/** A message if this member may not control the music in `channel`, otherwise null. */
function denyFor(channel: VoiceBasedChannel, member: GuildMember): string | null {
  return denyControl(
    channel.permissionOverwrites.cache.values(),
    member.id,
    member.permissions.has(PermissionFlagsBits.Administrator),
  );
}

async function handle(i: ChatInputCommandInteraction): Promise<void> {
  if (i.guildId !== GUILD_ID || !i.guild) {
    await i.reply(ephemeral("This bot only works in the GridLabs server."));
    return;
  }
  const p = players.get(i.guildId);
  const member = i.member as GuildMember;

  // Everything except /play and /queue changes what is playing, so it is only for someone sitting in
  // the bot's channel -- and, in a member-owned channel, only for its owner (or an administrator).
  if (CONTROL_COMMANDS.has(i.commandName)) {
    if (!p?.channelId) return void (await i.reply(ephemeral("I'm not playing anything.")));
    if (member.voice.channelId !== p.channelId) {
      return void (await i.reply(ephemeral(`Join <#${p.channelId}> to control the music.`)));
    }
    const botChannel = i.guild.channels.cache.get(p.channelId);
    const denied = botChannel?.isVoiceBased() ? denyFor(botChannel, member) : null;
    if (denied) return void (await i.reply(ephemeral(denied)));
  }

  switch (i.commandName) {
    case "play": {
      const voice = member.voice.channel;
      if (!voice) return void (await i.reply(ephemeral("Join a voice channel first, then use /play.")));
      const notAllowed = denyFor(voice, member);
      if (notAllowed) return void (await i.reply(ephemeral(notAllowed)));
      const existing = players.get(i.guildId);
      // One bot account = one voice channel per server. If it is busy elsewhere, say so rather than yanking it away.
      if (existing?.playing && existing.channelId && existing.channelId !== voice.id) {
        return void (await i.reply(ephemeral(`I'm already playing music in <#${existing.channelId}>. Join that channel, or wait until it finishes.`)));
      }
      const target = parseTarget(i.options.getString("song", true));
      if ("error" in target) return void (await i.reply(ephemeral(target.error)));

      await i.deferReply();
      let info;
      try {
        info = await lookup(target);
      } catch (err) {
        const message = err instanceof YtdlpError ? err.userMessage : "I couldn't look that up.";
        console.error("Lookup failed:", err instanceof Error ? err.message : err);
        return void (await i.editReply(`⚠️ ${message}`));
      }
      const player = playerFor(i.guildId);
      try {
        await player.connect(voice, i.channel && i.channel.isSendable() ? i.channel : null);
        const where = player.enqueue({ ...info, requestedBy: member.displayName });
        await i.editReply(
          where === "playing"
            ? `🎶 Starting **${info.title}** (${formatDuration(info.durationSeconds)})`
            : `➕ Queued **${info.title}** (${formatDuration(info.durationSeconds)}) — position ${where}`,
        );
      } catch (err) {
        await i.editReply(`⚠️ ${err instanceof Error ? err.message : "I couldn't play that."}`);
      }
      return;
    }
    case "skip":
      return void (await i.reply(p?.skip() ? "⏭️ Skipped." : ephemeral("Nothing is playing.")));
    case "pause":
      return void (await i.reply(p?.playing && p.pause() ? "⏸️ Paused." : ephemeral("Nothing is playing.")));
    case "resume":
      return void (await i.reply(p?.playing && p.resume() ? "▶️ Resumed." : ephemeral("Nothing is paused.")));
    case "stop":
      if (!p) return void (await i.reply(ephemeral("I'm not playing anything.")));
      p.stop();
      return void (await i.reply("⏹️ Stopped and left the channel."));
    case "queue": {
      if (!p?.current) return void (await i.reply(ephemeral("The queue is empty.")));
      const lines = [`**Now:** ${p.current.title} (${formatDuration(p.current.durationSeconds)})`];
      p.queue.slice(0, 10).forEach((t, n) => lines.push(`${n + 1}. ${t.title} (${formatDuration(t.durationSeconds)})`));
      if (p.queue.length > 10) lines.push(`…and ${p.queue.length - 10} more`);
      return void (await i.reply({ content: lines.join("\n"), allowedMentions: { parse: [] } }));
    }
    case "volume": {
      const percent = i.options.getInteger("percent", true);
      playerFor(i.guildId).setVolume(percent);
      return void (await i.reply(`🔊 Volume set to ${percent}%. Anyone can also adjust it just for themselves: right-click the bot → User Volume.`));
    }
  }
}

process.on("SIGTERM", () => {
  for (const p of players.values()) p.destroy();
  void client.destroy().finally(() => process.exit(0));
});

await client.login(TOKEN);
