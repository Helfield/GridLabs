const DISCORD_API = "https://discord.com/api/v10";

export function botEnabled(): boolean {
  return Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);
}

export function guildId(): string {
  return process.env.DISCORD_GUILD_ID ?? "";
}

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Discord API ${status}: ${body}`);
  }
}

/** A REST call as the bot. Throws DiscordApiError on a non-2xx response; returns null for 204. */
export async function botFetch<T = unknown>(method: string, path: string, body?: unknown): Promise<T | null> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    // Rate limited: wait as long as Discord says, then try once more.
    const retry = ((await res.json().catch(() => ({}))) as { retry_after?: number }).retry_after ?? 1;
    await new Promise((r) => setTimeout(r, Math.ceil(retry * 1000)));
    return botFetch<T>(method, path, body);
  }
  if (!res.ok) throw new DiscordApiError(res.status, await res.text());
  if (res.status === 204) return null;
  return (await res.json()) as T;
}

export type GuildRole = { id: string; name: string; managed: boolean; position: number; color: number };
export type GuildChannel = { id: string; name: string; type: number };

/** Roles a reaction can hand out: not @everyone, not integration-managed. */
export async function listAssignableRoles(): Promise<GuildRole[]> {
  const roles = (await botFetch<GuildRole[]>("GET", `/guilds/${guildId()}/roles`)) ?? [];
  return roles.filter((r) => r.id !== guildId() && !r.managed).sort((a, b) => b.position - a.position);
}

/** Every channel in the server, sorted into the kinds the coach page offers. */
export async function listChannelsByKind(): Promise<{ text: GuildChannel[]; voice: GuildChannel[]; categories: GuildChannel[] }> {
  const all = (await botFetch<GuildChannel[]>("GET", `/guilds/${guildId()}/channels`)) ?? [];
  const byName = (a: GuildChannel, b: GuildChannel) => a.name.localeCompare(b.name);
  return {
    text: all.filter((c) => c.type === 0 || c.type === 5).sort(byName), // text, announcement
    voice: all.filter((c) => c.type === 2).sort(byName),
    categories: all.filter((c) => c.type === 4).sort(byName),
  };
}

/** Text and announcement channels (types 0 and 5). */
export async function listTextChannels(): Promise<GuildChannel[]> {
  return (await listChannelsByKind()).text;
}

export type GuildEmoji = { id: string; name: string; animated: boolean };

/** The server's custom emoji, for the picker and for resolving `:name:`. */
export async function listGuildEmojis(): Promise<GuildEmoji[]> {
  const emojis = (await botFetch<GuildEmoji[]>("GET", `/guilds/${guildId()}/emojis`)) ?? [];
  return emojis.sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * Normalises what a coach typed into the key the API and gateway use:
 * a unicode emoji stays as is; `<:name:id>` / `<a:name:id>` becomes "name:id".
 */
export function parseEmoji(input: string, custom: GuildEmoji[] = []): string | null {
  const text = input.trim();
  if (!text) return null;
  // `:name:` picks one of the server's own emoji by name.
  const named = text.match(/^:(\w+):$/);
  if (named) {
    const hit = custom.find((e) => e.name.toLowerCase() === named[1].toLowerCase());
    return hit ? `${hit.name}:${hit.id}` : null;
  }
  const pasted = text.match(/^<a?:(\w+):(\d+)>$/);
  if (pasted) return `${pasted[1]}:${pasted[2]}`;
  if (/^\w+:\d+$/.test(text)) return text;
  // Anything else must be an actual emoji, not plain text like "gt3".
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}|[#-9]️?⃣/u.test(text)) return null;
  return text;
}

/** How an emoji key is shown in a message body. */
export function emojiDisplay(key: string): string {
  const m = key.match(/^(\w+):(\d+)$/);
  return m ? `<:${m[1]}:${m[2]}>` : key;
}
