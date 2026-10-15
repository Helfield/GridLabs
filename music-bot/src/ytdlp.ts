import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { ytdlpArgument, type Target } from "./target.ts";

export type TrackInfo = { id: string; title: string; durationSeconds: number | null; url: string };

/** Written at startup from YT_COOKIES (see index.ts) when YouTube asks the bot to sign in. */
export const COOKIES_FILE = "/tmp/yt-cookies.txt";

function commonArgs(): string[] {
  return ["--no-playlist", "--no-warnings", "-f", "bestaudio/best", ...(existsSync(COOKIES_FILE) ? ["--cookies", COOKIES_FILE] : [])];
}

/** yt-dlp's own words for "YouTube thinks this is a bot", turned into something a member can act on. */
export function explainFailure(stderr: string): string {
  if (/sign in to confirm|not a bot|confirm you.re not/i.test(stderr)) {
    return "YouTube is blocking the bot's server right now (it asks to \"confirm you're not a bot\"). Try again later, or ask a coach to add YouTube cookies to the bot.";
  }
  if (/private video|video unavailable|this video is not available|removed/i.test(stderr)) return "That video is unavailable.";
  if (/age|inappropriate|confirm your age/i.test(stderr)) return "That video is age-restricted, so the bot can't play it.";
  if (/live event will begin|premieres in/i.test(stderr)) return "That video hasn't started yet.";
  return "I couldn't get audio for that. Try a different link or search.";
}

export class YtdlpError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string, detail: string) {
    super(detail);
    this.userMessage = userMessage;
  }
}

function run(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new YtdlpError("The audio fetcher isn't available right now.", String(e)));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out);
      else reject(new YtdlpError(explainFailure(err), err.slice(-2000) || `yt-dlp exited with ${code}`));
    });
  });
}

/** Looks up what a link or search resolves to (without downloading anything). */
export async function lookup(target: Target): Promise<TrackInfo> {
  const out = await run(
    [...commonArgs(), "--print", "%(.{id,title,duration,webpage_url})j", "--", ytdlpArgument(target)],
    45_000,
  );
  const first = out.trim().split("\n")[0];
  const info = JSON.parse(first) as { id?: string; title?: string; duration?: number | null; webpage_url?: string };
  if (!info.id || !info.webpage_url) throw new YtdlpError("I couldn't find anything for that.", first);
  return {
    id: info.id,
    title: info.title || "Untitled",
    durationSeconds: typeof info.duration === "number" ? info.duration : null,
    url: info.webpage_url,
  };
}

export type AudioStream = { stream: Readable; stop: () => void; stderr: () => string };

/**
 * yt-dlp downloads the best audio and pipes it into ffmpeg, which decodes it to
 * raw 48 kHz stereo PCM -- what Discord's voice connection wants.
 */
export function openStream(url: string): AudioStream {
  const ytdlp = spawn("yt-dlp", [...commonArgs(), "-q", "-o", "-", "--", url], { stdio: ["ignore", "pipe", "pipe"] });
  const ffmpeg = spawn(
    "ffmpeg",
    ["-loglevel", "error", "-i", "pipe:0", "-vn", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let errText = "";
  ytdlp.stderr.on("data", (d) => (errText += d));
  ffmpeg.stderr.on("data", (d) => (errText += d));
  // Either end can close early (skip, stop, a bad video); that is not an error worth crashing over.
  ytdlp.stdout.on("error", () => {});
  ffmpeg.stdin.on("error", () => {});
  ffmpeg.stdout.on("error", () => {});
  ytdlp.stdout.pipe(ffmpeg.stdin);

  const kill = (p: ChildProcess) => {
    if (!p.killed) p.kill("SIGKILL");
  };
  return {
    stream: ffmpeg.stdout,
    stop: () => {
      kill(ytdlp);
      kill(ffmpeg);
    },
    stderr: () => errText,
  };
}
