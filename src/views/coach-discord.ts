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

// Dark form controls. Without color-scheme the browser draws white dropdown
// lists and inputs; the option rules cover the open list, which ignores the
// select's own background in some browsers.
const CSS = `
<style>
.rr-in{
  width:100%;padding:11px 13px;background:var(--carbon);border:1px solid var(--line);
  border-radius:var(--r-sm);color:var(--text);font:inherit;font-size:14.5px;color-scheme:dark;
}
.rr-in:focus{outline:none;border-color:var(--fastest);box-shadow:0 0 0 3px rgba(177,75,255,.15)}
.rr-in::placeholder{color:var(--dim)}
.rr-in option{background:var(--panel-2);color:var(--text)}
</style>`;

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
    voice: { lobbyId: string | null; voiceChannels: GuildChannel[]; categories: GuildChannel[]; notice: string | null };
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
        <input type="text" name="emoji" class="rr-in" placeholder="Emoji or :name:" list="rr-emojis" autocomplete="off">
        <select name="roleId" class="rr-in"><option value="">— role —</option>${roleOptions}</select>
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
      <a href="/coach/discord/message/${escapeHtml(messageId)}">Edit</a>
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
${CSS}
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

<section class="panel" style="margin-top:18px">
  <div class="panel__head"><h2>Temporary voice channels</h2><span class="tag">${opts.voice.lobbyId ? "on" : "off"}</span></div>
  <div class="panel__body">
    <p class="hint">Pick a voice channel to act as the lobby. When a member joins it, the bot makes them a voice channel of their own (right next to the lobby), moves them in, and lets them rename it from Discord. A channel the bot made is deleted once nobody has been in it for 30 seconds. Anyone who rejoins the lobby is put back in the channel they already own.</p>
    ${opts.voice.notice ? `<p class="hint" style="color:var(--pb)">${escapeHtml(opts.voice.notice)}</p>` : ""}
    ${(() => {
      const current = opts.voice.voiceChannels.find((c) => c.id === opts.voice.lobbyId);
      return opts.voice.lobbyId
        ? `<p class="hint">Lobby right now: <strong>${current ? `🔊 ${escapeHtml(current.name)}` : "a channel that no longer exists — pick another"}</strong></p>`
        : "";
    })()}
    <form action="/coach/discord/voice" method="post" style="margin-top:10px;max-width:520px">
      <input type="hidden" name="action" value="set">
      <label class="field">
        <span class="field__label">Use an existing voice channel as the lobby</span>
        <select name="channelId" class="rr-in" required><option value="">— voice channel —</option>${opts.voice.voiceChannels
          .map((c) => `<option value="${escapeHtml(c.id)}"${c.id === opts.voice.lobbyId ? " selected" : ""}>🔊 ${escapeHtml(c.name)}</option>`)
          .join("")}</select>
      </label>
      <button class="btn btn--ghost btn--sm" type="submit"${opts.enabled ? "" : " disabled"}>Set as lobby</button>
    </form>
    <form action="/coach/discord/voice" method="post" style="margin-top:18px;max-width:520px">
      <input type="hidden" name="action" value="create">
      <span class="field__label">Or have the bot create the lobby</span>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <input type="text" name="name" class="rr-in" value="➕ Create a channel" autocomplete="off" aria-label="Lobby name">
        <select name="categoryId" class="rr-in" aria-label="Category"><option value="">No category</option>${opts.voice.categories
          .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
          .join("")}</select>
      </div>
      <button class="btn btn--ghost btn--sm" type="submit"${opts.enabled ? "" : " disabled"}>Create lobby channel</button>
    </form>
    ${
      opts.voice.lobbyId
        ? `<form action="/coach/discord/voice" method="post" style="margin-top:18px"><input type="hidden" name="action" value="off"><button class="linkbtn" type="submit" style="color:var(--warn)">Turn off temporary voice channels</button></form>`
        : ""
    }
  </div>
</section>

<template id="rr-panel-tpl">
  <section class="panel" style="margin-bottom:18px">
    <div class="panel__head"><h2 class="rr-title">New reaction roles</h2><button class="linkbtn rr-remove" type="button" style="color:var(--warn)">Remove panel</button></div>
    <div class="panel__body">
      <form action="/coach/discord/panel" method="post">
        <label class="field">
          <span class="field__label">Channel</span>
          <select name="channelId" required class="rr-in"><option value="">— channel —</option>${channelOptions}</select>
        </label>
        <label class="field">
          <span class="field__label">Existing message ID (optional)</span>
          <input type="text" name="messageId" class="rr-in" placeholder="Leave blank to post a new message" autocomplete="off">
        </label>
        <label class="field rr-text">
          <span class="field__label">Message text (new messages only)</span>
          <input type="text" name="text" class="rr-in" placeholder="e.g. Pick your SR rank:">
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
  var KEY = "rr-draft-v1";
  var PENDING = "rr-pending";
  var panels = document.getElementById("rr-panels");
  var panelTpl = document.getElementById("rr-panel-tpl");
  var rowTpl = document.getElementById("rr-row-tpl");

  // Drafts: what has been typed is kept in this browser, so a refused Create or an
  // accidental refresh doesn't lose a long list. A panel is dropped from the draft
  // only once it has been created successfully.
  function readDraft() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
  }
  function writeDraft(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  }
  function snapshot(panel) {
    var rows = [];
    panel.querySelectorAll(".rr-row").forEach(function (r) {
      rows.push([r.querySelector("[name=emoji]").value, r.querySelector("[name=roleId]").value]);
    });
    return {
      channelId: panel.querySelector("[name=channelId]").value,
      messageId: panel.querySelector("[name=messageId]").value,
      text: panel.querySelector("[name=text]").value,
      rows: rows
    };
  }
  function isEmpty(d) {
    return !d.channelId && !d.messageId && !d.text && d.rows.every(function (r) { return !r[0] && !r[1]; });
  }
  function saveAll() {
    var list = [];
    panels.querySelectorAll("section.panel").forEach(function (p) { list.push(snapshot(p)); });
    writeDraft(list.filter(function (d) { return !isEmpty(d); }));
  }

  function addRow(panel) {
    var rows = panel.querySelector(".rr-rows");
    if (rows.children.length >= MAX_ROWS) {
      alert("Discord allows 20 reactions on one message. Add another panel for more.");
      return null;
    }
    var row = rowTpl.content.firstElementChild.cloneNode(true);
    rows.appendChild(row);
    return row;
  }

  function addPanel(channelId, messageId) {
    var panel = panelTpl.content.firstElementChild.cloneNode(true);
    panel.querySelector(".rr-add-row").addEventListener("click", function () { addRow(panel); });
    panel.querySelector(".rr-remove").addEventListener("click", function () { panel.remove(); saveAll(); });
    panel.addEventListener("input", saveAll);
    panel.addEventListener("change", saveAll);
    panel.querySelector("form").addEventListener("submit", function () {
      saveAll();
      // Position among the saved (non-empty) drafts, which is what ?done=1 will look up.
      var pos = 0;
      for (var i = 0; i < panels.children.length; i++) {
        if (panels.children[i] === panel) break;
        if (!isEmpty(snapshot(panels.children[i]))) pos++;
      }
      try { localStorage.setItem(PENDING, String(pos)); } catch (e) {}
    });
    if (channelId) panel.querySelector("[name=channelId]").value = channelId;
    if (messageId) {
      panel.querySelector("[name=messageId]").value = messageId;
      panel.querySelector(".rr-title").textContent = "Add to an existing message";
      panel.querySelector(".rr-text").style.display = "none";
    }
    panels.appendChild(panel);
    return panel;
  }

  function restore(d) {
    var panel = addPanel(d.channelId, d.messageId);
    panel.querySelector("[name=text]").value = d.text || "";
    var rows = panel.querySelectorAll(".rr-row");
    d.rows.forEach(function (pair, i) {
      var row = rows[i] || addRow(panel);
      if (!row) return;
      row.querySelector("[name=emoji]").value = pair[0] || "";
      row.querySelector("[name=roleId]").value = pair[1] || "";
    });
  }

  document.getElementById("rr-add-panel").addEventListener("click", function () {
    addPanel().scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  document.querySelectorAll("[data-add-to]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      addPanel(btn.getAttribute("data-channel"), btn.getAttribute("data-add-to")).scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  // A successful Create lands here with ?done=1: that panel is finished, so it leaves the draft.
  var drafts = readDraft();
  if (/[?&]done=1/.test(location.search)) {
    var idx = -1;
    try { idx = parseInt(localStorage.getItem(PENDING), 10); localStorage.removeItem(PENDING); } catch (e) {}
    if (idx >= 0 && idx < drafts.length) { drafts.splice(idx, 1); writeDraft(drafts); }
  }
  if (drafts.length) drafts.forEach(restore); else addPanel();
})();
</script>`;
  return layout("Discord reaction roles", body, navUser);
}

// Edit page for one live message: every emoji/role pair is shown filled in, so
// a change is a tweak and Save, not a rebuild. Saving makes the message's
// reaction roles exactly what is on screen.
export function discordEditPage(
  navUser: Nav,
  opts: {
    enabled: boolean;
    guildId: string;
    channelId: string;
    channelName: string | null;
    messageId: string;
    text: string | null; // null: the bot didn't post this message, so its wording isn't ours to edit
    rows: Array<{ emoji: string; roleId: string }>;
    roles: GuildRole[];
    emojis: GuildEmoji[];
    error: string | null;
    notice: string | null;
  },
): string {
  const roleOptions = (selected: string) =>
    opts.roles
      .map((r) => `<option value="${escapeHtml(r.id)}"${r.id === selected ? " selected" : ""}>${escapeHtml(r.name)}</option>`)
      .join("");
  // Show a custom emoji as :name: (what the form accepts); unicode as itself.
  const emojiText = (key: string): string => {
    const m = key.match(/^(\w+):(\d+)$/);
    if (!m) return key;
    const hit = opts.emojis.find((e) => e.id === m[2]);
    return hit ? `:${hit.name}:` : key;
  };
  const row = (emoji: string, roleId: string) => `
      <div class="rr-row" style="display:grid;grid-template-columns:130px 1fr auto;gap:10px;margin-bottom:10px;align-items:center">
        <input type="text" name="emoji" class="rr-in" value="${escapeHtml(emoji)}" placeholder="Emoji or :name:" list="rr-emojis" autocomplete="off">
        <select name="roleId" class="rr-in"><option value="">— role —</option>${roleOptions(roleId)}</select>
        <button class="linkbtn rr-del" type="button" style="color:var(--warn)" title="Remove this row">✕</button>
      </div>`;
  const link = `https://discord.com/channels/${opts.guildId}/${opts.channelId}/${opts.messageId}`;
  const emojiList = opts.emojis.map((e) => `<option value=":${escapeHtml(e.name)}:"></option>`).join("");

  const body = `
${CSS}
<a class="backlink" href="/coach/discord">← Reaction roles</a>
<div class="phead">
  <div>
    <span class="eyebrow">Coaching</span>
    <h1>Edit reaction roles</h1>
    <p class="phead__sub">${opts.channelName ? `#${escapeHtml(opts.channelName)} · ` : ""}<a href="${escapeHtml(link)}" target="_blank" rel="noopener">Open message in Discord ↗</a></p>
  </div>
</div>
${opts.notice ? `<p class="hint" style="color:var(--pb)">${escapeHtml(opts.notice)}</p>` : ""}
${opts.error ? `<p class="hint" style="color:var(--warn)">${escapeHtml(opts.error)}</p>` : ""}
<datalist id="rr-emojis">${emojiList}</datalist>
<section class="panel" style="max-width:640px">
  <div class="panel__body">
    <form action="/coach/discord/message/${escapeHtml(opts.messageId)}" method="post" id="rr-edit">
      ${
        opts.text === null
          ? `<p class="hint">This message wasn't posted by the bot, so its text can't be changed here — only the emoji and roles.</p>`
          : `<label class="field">
        <span class="field__label">Message text</span>
        <input type="text" name="text" class="rr-in" value="${escapeHtml(opts.text)}" placeholder="e.g. Pick your SR rank:">
      </label>`
      }
      <span class="field__label">Emoji → role</span>
      <div class="rr-rows">${opts.rows.map((r) => row(emojiText(r.emoji), r.roleId)).join("")}</div>
      <button class="btn btn--ghost btn--sm" type="button" id="rr-add-row" style="margin-bottom:12px">+ Add row</button>
      <p class="hint">Change an emoji or role in place, remove a row with ✕, or add rows (up to 20 per message). Save updates the message and the bot's reactions; everyone who already has a role keeps it. Members who click a <em>new</em> emoji from now on get its role.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
        <button class="btn btn--discord" style="width:auto;padding-left:26px;padding-right:26px" type="submit"${opts.enabled ? "" : " disabled"}>Save changes</button>
      </div>
    </form>
    <form action="/coach/discord/message/${escapeHtml(opts.messageId)}/delete" method="post" style="margin-top:14px" onsubmit="return confirm('Stop every emoji on this message giving roles? The message itself stays in Discord.')">
      <button class="linkbtn" type="submit" style="color:var(--warn)">Stop all reaction roles on this message</button>
    </form>
  </div>
</section>
<template id="rr-row-tpl">${row("", "")}</template>
<script>
(function () {
  var form = document.getElementById("rr-edit");
  var rows = form.querySelector(".rr-rows");
  var tpl = document.getElementById("rr-row-tpl");
  form.addEventListener("click", function (e) {
    if (e.target.classList.contains("rr-del")) e.target.closest(".rr-row").remove();
  });
  document.getElementById("rr-add-row").addEventListener("click", function () {
    if (rows.children.length >= 20) { alert("Discord allows 20 reactions on one message."); return; }
    rows.appendChild(tpl.content.firstElementChild.cloneNode(true));
  });
})();
</script>`;
  return layout("Edit reaction roles", body, navUser);
}
