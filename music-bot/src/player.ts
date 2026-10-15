import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type AudioResource,
  type VoiceConnection,
} from "@discordjs/voice";
import type { SendableChannels, VoiceBasedChannel } from "discord.js";
import { explainFailure, openStream, type AudioStream, type TrackInfo } from "./ytdlp.ts";
import { formatDuration } from "./target.ts";

export type Track = TrackInfo & { requestedBy: string };

const MAX_QUEUE = 50;
const IDLE_LEAVE_MS = 2 * 60_000; // nothing left to play: leave after two minutes
const EMPTY_LEAVE_MS = 30_000; // everyone else left the channel: leave after 30 seconds

/**
 * One server's music: the queue, the voice connection and the volume.
 *
 * A bot account can sit in only one voice channel per server, so there is one
 * of these per server and it is tied to a single channel at a time.
 */
export class GuildPlayer {
  readonly guildId: string;
  /** 0..1 linear gain applied to everything played. Starts at the configured default (50%). */
  volume: number;
  channelId: string | null = null;
  current: Track | null = null;
  queue: Track[] = [];

  private connection: VoiceConnection | null = null;
  private readonly player: AudioPlayer;
  private resource: AudioResource | null = null;
  private audio: AudioStream | null = null;
  private textChannel: SendableChannels | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private emptyTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onDestroy: () => void;
  private destroyed = false;

  constructor(guildId: string, defaultVolume: number, onDestroy: () => void) {
    this.guildId = guildId;
    this.volume = defaultVolume;
    this.onDestroy = onDestroy;
    this.player = createAudioPlayer();
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.destroyed) return; // destroy() stops the player, which also reports Idle
      this.cleanupStream();
      this.current = null;
      void this.playNext();
    });
    this.player.on("error", (err) => {
      console.error("Audio player error:", err.message);
      this.say(`Something went wrong playing **${this.current?.title ?? "that track"}**, skipping it.`);
    });
  }

  get playing(): boolean {
    return this.current !== null;
  }

  /** Joins (or moves to) the member's channel. Throws a member-readable Error if it can't. */
  async connect(channel: VoiceBasedChannel, text: SendableChannels | null): Promise<void> {
    this.textChannel = text ?? this.textChannel;
    if (this.connection && this.channelId === channel.id && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      return;
    }
    this.connection?.destroy();
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: this.guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection = connection;
    this.channelId = channel.id;
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Moved to another channel or briefly dropped: Discord reconnects by itself within a few seconds.
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy(); // kicked or really disconnected
      }
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      this.destroy();
      throw new Error("I couldn't join that voice channel. Check I have permission to Connect and Speak there.");
    }
    connection.subscribe(this.player);
    this.clearEmptyTimer();
  }

  enqueue(track: Track): "playing" | number {
    if (this.queue.length >= MAX_QUEUE) throw new Error(`The queue is full (${MAX_QUEUE} tracks).`);
    this.clearIdleTimer();
    if (!this.current && this.player.state.status === AudioPlayerStatus.Idle && this.queue.length === 0) {
      this.queue.push(track);
      void this.playNext();
      return "playing";
    }
    this.queue.push(track);
    return this.queue.length;
  }

  private async playNext(): Promise<void> {
    const next = this.queue.shift();
    if (!next) {
      this.current = null;
      this.startIdleTimer();
      return;
    }
    this.current = next;
    const audio = openStream(next.url);
    this.audio = audio;
    const resource = createAudioResource(audio.stream, { inputType: StreamType.Raw, inlineVolume: true });
    // Every track starts at the server's volume (default 50%), so nothing arrives at full blast.
    resource.volume?.setVolume(this.volume);
    this.resource = resource;
    this.player.play(resource);
    this.say(`▶️ Now playing **${next.title}** (${formatDuration(next.durationSeconds)}) — requested by ${next.requestedBy}`);
    // If the audio never starts (YouTube refused), the stream ends with nothing; report why and move on.
    audio.stream.once("close", () => {
      if (this.audio !== audio) return;
      const detail = audio.stderr();
      if (detail && this.resource && this.resource.playbackDuration < 1_000) {
        this.say(`⚠️ ${explainFailure(detail)}`);
        console.error("yt-dlp/ffmpeg ended early:", detail.slice(-1000));
      }
    });
  }

  setVolume(percent: number): void {
    this.volume = Math.min(1, Math.max(0, percent / 100));
    this.resource?.volume?.setVolume(this.volume);
  }

  skip(): boolean {
    if (!this.current) return false;
    this.player.stop(true); // fires Idle, which starts the next track
    return true;
  }

  pause(): boolean {
    return this.player.pause();
  }

  resume(): boolean {
    return this.player.unpause();
  }

  /** Stops playing, clears the queue and leaves the channel. */
  stop(): void {
    this.destroy();
  }

  /** Called when someone joins or leaves the bot's channel. */
  checkChannel(humansInChannel: number): void {
    if (humansInChannel > 0) this.clearEmptyTimer();
    else if (!this.emptyTimer && this.connection) this.emptyTimer = setTimeout(() => this.destroy(), EMPTY_LEAVE_MS);
  }

  private say(text: string): void {
    this.textChannel?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
  }

  private cleanupStream(): void {
    this.audio?.stop();
    this.audio = null;
    this.resource = null;
  }

  private startIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.destroy(), IDLE_LEAVE_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private clearEmptyTimer(): void {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearIdleTimer();
    this.clearEmptyTimer();
    this.queue = [];
    this.current = null;
    this.player.stop(true);
    this.cleanupStream();
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    this.connection = null;
    this.channelId = null;
    this.onDestroy();
  }
}
