import { layout, escapeHtml, type NavUser } from "./layout";
import { emojiDisplay, type GuildChannel, type GuildEmoji, type GuildRole } from "../discord/bot-api";

type Nav = NonNullable<NavUser>;

export type ReactionRoleRow = {
  id: number;
  channelId: string;
  messageId: string;
  emoji: string;
  roleId: string;
  roleName: string | null;
};

const START_ROWS = 4;

const INPUT =
  "width:100%;padding:11px 12px;background:var(--bg);border:1px solid var(--line);border-radius:8px;color:var(--text);font:inherit";

function emojiLabel(key: string): string {
  // Custom emoji can't render outside Discord, so show their name.
  const m = key.match(/^(\w+):\d+$/);
  return m ? `:${m[1]}:` : emojiDisplay(key);
}

// Coach-only page: create reaction-role messages and manage the existing ones.
// Each "panel" is its own form posting one message; the page can hold as many
// as needed, and each panel can take as many emoji/role rows as it needs (up to
// Discord's 20 reactions per message).
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
    emojis: GuildEmoji[];
  },
): string {
  const roleOptions = opts.roles
    .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`)
    .join("");
  const channelOptions = opts.channels
    .map((c) => `<option value="${escapeHtml(c.id)}">#${escapeHtml(c.name)}</option>`)
    .join("");
  const emojiList = opts.emojis.map((e) => `<option value=":${escapeHtml(e.name)}:"></option>`).join("");

  const row = `
      <div class="rr-row" style="display:grid;grid-template-columns:130px 1fr;gap:10px;margin-bottom:10px">
        <input type="text" name="emoji" placeholder="Emoji or :name:" list="rr-emojis" autocomplete="off">
        <select name="roleId" style="${INPUT}"><option value="">— role —</option>${roleOptions}</select>
      </div>`;

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
  <div class="ref__meta" style="margin-bottom:8px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
    <a href="${escapeHtml(link)}" target="_blank" rel="noopener">Open message in Discord ↗</a>
    <span>${rows.length} of 20 reactions
      <button class="linkbtn" type="button" data-add-to="${escapeHtml(messageId)}" data-channel="${escapeHtml(rows[0].channelId)}">+ Add more</button>
    </span>
  </div>
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
<datalist id="rr-emojis">${emojiList}</datalist>
<div class="grid-2">
  <div>
    <div id="rr-panels"></div>
    <button class="btn btn--ghost btn--sm" type="button" id="rr-add-panel">+ Add another panel</button>
    <p class="hint" style="margin-top:10px">Each panel posts one Discord message. Use a separate panel for each message or channel — Discord allows 20 reactions on a single message, so a long list (say SR and DR ranks) goes in two panels. Each panel is created on its own with its own Create button.</p>
  </div>
  <section class="panel">
    <div class="panel__head"><h2>Live now</h2><span class="tag">${opts.mappings.length}</span></div>
    <div class="panel__body">${existing}</div>
  </section>
</div>

<template id="rr-panel-tpl">
  <section class="panel" style="margin-bottom:18px">
    <div class="panel__head"><h2 class="rr-title">New reaction roles</h2><button class="linkbtn rr-remove" type="button" style="color:var(--warn)">Remove panel</button></div>
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
        <label class="field rr-text">
          <span class="field__label">Message text (new messages only)</span>
          <input type="text" name="text" placeholder="e.g. Pick your SR rank:">
        </label>
        <span class="field__label">Emoji → role</span>
        <div class="rr-rows">${row.repeat(START_ROWS)}</div>
        <button class="btn btn--ghost btn--sm rr-add-row" type="button" style="margin-bottom:12px">+ Add row</button>
        <p class="hint">Type an emoji, or <code>:name:</code> for one of this server's custom emoji (suggestions appear as you type). The bot adds each emoji to the message so members can click it. Empty rows are ignored. The bot's own role has to sit above the roles it hands out (Server Settings → Roles).</p>
        <button class="btn btn--discord" style="margin-top:6px" type="submit"${opts.enabled ? "" : " disabled"}>Create</button>
      </form>
    </div>
  </section>
</template>
<template id="rr-row-tpl">${row}</template>

<script>
(function () {
  var MAX_ROWS = 20;
  var panels = document.getElementById("rr-panels");
  var panelTpl = document.getElementById("rr-panel-tpl");
  var rowTpl = document.getElementById("rr-row-tpl");

  function addRow(panel) {
    var rows = panel.querySelector(".rr-rows");
    if (rows.children.length >= MAX_ROWS) {
      alert("Discord allows 20 reactions on one message. Add another panel for more.");
      return;
    }
    rows.appendChild(rowTpl.content.firstElementChild.cloneNode(true));
  }

  function addPanel(channelId, messageId) {
    var panel = panelTpl.content.firstElementChild.cloneNode(true);
    panel.querySelector(".rr-add-row").addEventListener("click", function () { addRow(panel); });
    panel.querySelector(".rr-remove").addEventListener("click", function () { panel.remove(); });
    if (channelId) panel.querySelector("[name=channelId]").value = channelId;
    if (messageId) {
      panel.querySelector("[name=messageId]").value = messageId;
      panel.querySelector(".rr-title").textContent = "Add to an existing message";
      panel.querySelector(".rr-text").style.display = "none";
    }
    panels.appendChild(panel);
    return panel;
  }

  document.getElementById("rr-add-panel").addEventListener("click", function () {
    addPanel().scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  document.querySelectorAll("[data-add-to]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      addPanel(btn.getAttribute("data-channel"), btn.getAttribute("data-add-to")).scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  addPanel();
})();
</script>`;
  return layout("Discord reaction roles", body, navUser);
}
