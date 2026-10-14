import { layout, escapeHtml, type NavUser } from "./layout";
import { emojiDisplay, type GuildChannel, type GuildRole } from "../discord/bot-api";

type Nav = NonNullable<NavUser>;

export type ReactionRoleRow = {
  id: number;
  channelId: string;
  messageId: string;
  emoji: string;
  roleId: string;
  roleName: string | null;
};

const SLOTS = 6;

const INPUT =
  "width:100%;padding:11px 12px;background:var(--bg);border:1px solid var(--line);border-radius:8px;color:var(--text);font:inherit";

function emojiLabel(key: string): string {
  // Custom emoji can't render outside Discord, so show their name.
  const m = key.match(/^(\w+):\d+$/);
  return m ? `:${m[1]}:` : emojiDisplay(key);
}

// Coach-only page: create reaction-role messages and manage the existing ones.
export function discordPage(
  navUser: Nav,
  opts: {
    enabled: boolean;
    guildId: string;
    notice: string | null;
    error: string | null;
    mappings: ReactionRoleRow[];
    roles: GuildRole[];
    channels: GuildChannel[];
  },
): string {
  const roleOptions = opts.roles
    .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`)
    .join("");
  const channelOptions = opts.channels
    .map((c) => `<option value="${escapeHtml(c.id)}">#${escapeHtml(c.name)}</option>`)
    .join("");

  const slots = Array.from(
    { length: SLOTS },
    () => `
      <div style="display:grid;grid-template-columns:90px 1fr;gap:10px;margin-bottom:10px">
        <input type="text" name="emoji" placeholder="Emoji" autocomplete="off">
        <select name="roleId" style="${INPUT}"><option value="">— role —</option>${roleOptions}</select>
      </div>`,
  ).join("");

  // Group by message so each reaction-role message reads as one block.
  const byMessage = new Map<string, ReactionRoleRow[]>();
  for (const m of opts.mappings) byMessage.set(m.messageId, [...(byMessage.get(m.messageId) ?? []), m]);
  const existing =
    byMessage.size === 0
      ? `<div class="empty"><strong>No reaction roles yet</strong>Create a message on the left and members can start picking roles.</div>`
      : [...byMessage.entries()]
          .map(([messageId, rows]) => {
            const link = `https://discord.com/channels/${opts.guildId}/${rows[0].channelId}/${messageId}`;
            return `
<div class="ref" style="display:block">
  <div class="ref__meta" style="margin-bottom:8px"><a href="${escapeHtml(link)}" target="_blank" rel="noopener">Open message in Discord ↗</a></div>
  ${rows
    .map(
      (r) => `
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:4px 0">
    <div class="ref__label">${escapeHtml(emojiLabel(r.emoji))} → ${escapeHtml(r.roleName ?? r.roleId)}</div>
    <form action="/coach/discord/mapping/${r.id}/delete" method="post" onsubmit="return confirm('Stop giving this role for this reaction?')">
      <button class="linkbtn" type="submit" style="color:var(--warn)">Remove</button>
    </form>
  </div>`,
    )
    .join("")}
</div>`;
          })
          .join("");

  const setup = opts.enabled
    ? ""
    : `<p class="hint" style="color:var(--warn)">The bot is off — set DISCORD_BOT_TOKEN in Railway's Variables (and redeploy) to turn it on.</p>`;

  const body = `
<a class="backlink" href="/coach">← All drivers</a>
<div class="phead">
  <div>
    <span class="eyebrow">Coaching</span>
    <h1>Discord reaction roles</h1>
    <p class="phead__sub">Members click an emoji on a message and the bot gives them the matching role; un-clicking takes it away.</p>
  </div>
</div>
${setup}
${opts.notice ? `<p class="hint" style="color:var(--pb)">${escapeHtml(opts.notice)}</p>` : ""}
${opts.error ? `<p class="hint" style="color:var(--warn)">${escapeHtml(opts.error)}</p>` : ""}
<div class="grid-2">
  <section class="panel">
    <div class="panel__head"><h2>New reaction roles</h2></div>
    <div class="panel__body">
      <form action="/coach/discord/panel" method="post">
        <label class="field">
          <span class="field__label">Channel</span>
          <select name="channelId" required style="${INPUT}"><option value="">— channel —</option>${channelOptions}</select>
        </label>
        <label class="field">
          <span class="field__label">Existing message ID (optional)</span>
          <input type="text" name="messageId" placeholder="Leave blank to post a new message" autocomplete="off">
        </label>
        <label class="field">
          <span class="field__label">Message text (new messages only)</span>
          <input type="text" name="text" placeholder="e.g. Pick your class roles:">
        </label>
        <span class="field__label">Emoji → role</span>
        ${slots}
        <p class="hint">Type or paste an emoji (a custom server emoji works too, pasted as Discord shows it). The bot adds each emoji to the message so members can click it. Fill only the rows you need. The bot's own role has to sit above the roles it hands out (Server Settings → Roles).</p>
        <button class="btn btn--discord" style="margin-top:6px" type="submit"${opts.enabled ? "" : " disabled"}>Create</button>
      </form>
    </div>
  </section>
  <section class="panel">
    <div class="panel__head"><h2>Live now</h2><span class="tag">${opts.mappings.length}</span></div>
    <div class="panel__body">${existing}</div>
  </section>
</div>`;
  return layout("Discord reaction roles", body, navUser);
}
