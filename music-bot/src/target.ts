/**
 * What a member typed after /play: a YouTube link, or words to search for.
 *
 * Only YouTube hosts are accepted as links. yt-dlp can fetch from hundreds of
 * sites -- and from any address it is given -- so letting members hand it
 * arbitrary URLs would let them point a server-side fetcher anywhere.
 */

export type Target = { kind: "url"; value: string } | { kind: "search"; value: string };

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

export const MAX_SEARCH_LENGTH = 200;

/** Returns the target, or a message to show the member if the input can't be used. */
export function parseTarget(input: string): Target | { error: string } {
  const text = input.trim();
  if (!text) return { error: "Give me a YouTube link or something to search for." };

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^www\./i.test(text)) {
    let url: URL;
    try {
      url = new URL(/^www\./i.test(text) ? `https://${text}` : text);
    } catch {
      return { error: "That doesn't look like a valid link." };
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
      return { error: "I can only play YouTube links. Paste a YouTube link, or type the song name to search." };
    }
    if (url.username || url.password) return { error: "That doesn't look like a valid link." };
    return { kind: "url", value: url.toString() };
  }

  if (text.length > MAX_SEARCH_LENGTH) return { error: `Search text is too long (max ${MAX_SEARCH_LENGTH} characters).` };
  // Single line only: the search text is passed on as one yt-dlp argument.
  return { kind: "search", value: text.replace(/\s+/g, " ") };
}

/** The argument handed to yt-dlp (after a `--`, so it can never be read as an option). */
export function ytdlpArgument(target: Target): string {
  return target.kind === "url" ? target.value : `ytsearch1:${target.value}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return "live";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
