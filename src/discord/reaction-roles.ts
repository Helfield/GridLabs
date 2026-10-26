import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { reactionPanels, reactionRoles } from "../db/schema";
import { botFetch, emojiDisplay, guildId } from "./bot-api";

export type RolePair = { emoji: string; roleId: string; roleName: string };

export async function listReactionRoles() {
  return db.select().from(reactionRoles).orderBy(reactionRoles.messageId, reactionRoles.id);
}

/** How many distinct emoji already hand out roles on a message (Discord allows 20 reactions per message). */
export async function emojisOnMessage(messageId: string): Promise<string[]> {
  const rows = await db.select({ emoji: reactionRoles.emoji }).from(reactionRoles).where(eq(reactionRoles.messageId, messageId));
  return rows.map((r) => r.emoji);
}

export const MAX_REACTIONS_PER_MESSAGE = 20;

export async function findRoleFor(messageId: string, emoji: string): Promise<string | null> {
  const [row] = await db
    .select({ roleId: reactionRoles.roleId })
    .from(reactionRoles)
    .where(and(eq(reactionRoles.messageId, messageId), eq(reactionRoles.emoji, emoji)))
    .limit(1);
  return row?.roleId ?? null;
}

/**
 * The other choices this message hands out. One message is treated as one
 * choice, so a member who clicks a second emoji is moved rather than added to:
 * see onReaction in gateway.ts, which takes these roles off and clears the
 * member's own reaction for them. The names are only for the log line.
 */
export async function otherChoicesOnMessage(
  messageId: string,
  roleId: string,
): Promise<{ emoji: string; roleId: string; roleName: string | null }[]> {
  const rows = await db
    .select({ emoji: reactionRoles.emoji, roleId: reactionRoles.roleId, roleName: reactionRoles.roleName })
    .from(reactionRoles)
    .where(eq(reactionRoles.messageId, messageId));
  return rows.filter((r) => r.roleId !== roleId);
}

/** Role ids a member holds, for the reactions whose event didn't carry them. */
export async function memberRoleIds(userId: string): Promise<string[]> {
  const member = await botFetch<{ roles?: string[] }>("GET", `/guilds/${guildId()}/members/${userId}`);
  return member?.roles ?? [];
}

async function addBotReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
  await botFetch("PUT", `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);
}

/**
 * Posts a new message in `channelId` describing the pairs, saves them, and
 * reacts with each emoji so members have something to click.
 */
export async function createPanel(channelId: string, text: string, pairs: RolePair[]): Promise<string> {
  const lines = pairs.map((p) => `${emojiDisplay(p.emoji)}  **${p.roleName}**`);
  const content = [text.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
  const msg = await botFetch<{ id: string }>("POST", `/channels/${channelId}/messages`, {
    content,
    allowed_mentions: { parse: [] },
  });
  if (!msg) throw new Error("Discord returned no message");
  await db.insert(reactionPanels).values({ messageId: msg.id, channelId, text: text.trim() });
  await saveAndReact(channelId, msg.id, pairs);
  return msg.id;
}

/** Attaches pairs to a message that already exists. Throws if the bot can't see it. */
export async function attachToMessage(channelId: string, messageId: string, pairs: RolePair[]): Promise<void> {
  await botFetch("GET", `/channels/${channelId}/messages/${messageId}`);
  await saveAndReact(channelId, messageId, pairs);
}

async function saveAndReact(channelId: string, messageId: string, pairs: RolePair[]): Promise<void> {
  for (const p of pairs) {
    await db
      .insert(reactionRoles)
      .values({ channelId, messageId, emoji: p.emoji, roleId: p.roleId, roleName: p.roleName })
      .onConflictDoUpdate({
        target: [reactionRoles.messageId, reactionRoles.emoji],
        set: { roleId: p.roleId, roleName: p.roleName, channelId },
      });
    await addBotReaction(channelId, messageId, p.emoji);
  }
}

export async function deleteMapping(id: number): Promise<void> {
  const [row] = await db.delete(reactionRoles).where(eq(reactionRoles.id, id)).returning();
  if (row) {
    await removeBotReaction(row.channelId, row.messageId, row.emoji);
    await refreshMessageText(row.messageId);
  }
}

async function removeBotReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
  // Only the bot's own seed reaction: members' clicks stay, so nobody's role is touched.
  await botFetch("DELETE", `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`).catch(
    () => {},
  );
}

/**
 * Takes one member's reaction off a message. This is what lets a picker be used
 * again: Discord leaves an earlier click highlighted, so a driver who moved from
 * Bronze 3 to Silver 2 still saw Bronze 3 lit up and took that for "the panel
 * only works once". Needs MANAGE_MESSAGES in that channel.
 */
export async function removeMemberReaction(channelId: string, messageId: string, emoji: string, userId: string): Promise<void> {
  await botFetch("DELETE", `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/${userId}`);
}

export async function getPanel(messageId: string) {
  const [row] = await db.select().from(reactionPanels).where(eq(reactionPanels.messageId, messageId)).limit(1);
  return row ?? null;
}

export async function mappingsForMessage(messageId: string) {
  return db.select().from(reactionRoles).where(eq(reactionRoles.messageId, messageId)).orderBy(reactionRoles.id);
}

/**
 * Rewrites a bot-posted message so its list matches the current pairs. Does
 * nothing for a message the bot didn't post (it can't edit those), and never
 * fails the caller: the pairs are what matter, the wording is cosmetic.
 */
export async function refreshMessageText(messageId: string, newText?: string): Promise<void> {
  const panel = await getPanel(messageId);
  if (!panel) return;
  const text = newText ?? panel.text;
  if (newText !== undefined) await db.update(reactionPanels).set({ text }).where(eq(reactionPanels.messageId, messageId));
  const rows = await mappingsForMessage(messageId);
  const lines = rows.map((r) => `${emojiDisplay(r.emoji)}  **${r.roleName ?? r.roleId}**`);
  const content = [text.trim(), lines.join("\n")].filter(Boolean).join("\n\n") || "\u200b";
  await botFetch("PATCH", `/channels/${panel.channelId}/messages/${messageId}`, {
    content,
    allowed_mentions: { parse: [] },
  }).catch((err) => console.error("Updating reaction-role message text failed:", err));
}

/**
 * Makes a message's reaction roles exactly `pairs`: removed emoji stop giving
 * roles (and lose the bot's reaction), changed ones switch role, new ones are
 * added and reacted. Other panels are untouched.
 */
export async function syncMessage(messageId: string, pairs: RolePair[], newText?: string): Promise<void> {
  const current = await mappingsForMessage(messageId);
  if (current.length === 0) throw new Error("No reaction roles on that message");
  const channelId = current[0].channelId;
  for (const row of current) {
    if (!pairs.some((p) => p.emoji === row.emoji)) {
      await db.delete(reactionRoles).where(eq(reactionRoles.id, row.id));
      await removeBotReaction(channelId, messageId, row.emoji);
    }
  }
  for (const p of pairs) {
    const had = current.some((r) => r.emoji === p.emoji);
    await db
      .insert(reactionRoles)
      .values({ channelId, messageId, emoji: p.emoji, roleId: p.roleId, roleName: p.roleName })
      .onConflictDoUpdate({
        target: [reactionRoles.messageId, reactionRoles.emoji],
        set: { roleId: p.roleId, roleName: p.roleName },
      });
    if (!had) await addBotReaction(channelId, messageId, p.emoji);
  }
  await refreshMessageText(messageId, newText);
}

/** Stops every emoji on a message giving roles, and takes the bot's reactions off it. */
export async function deleteMessageMappings(messageId: string): Promise<void> {
  const rows = await db.delete(reactionRoles).where(eq(reactionRoles.messageId, messageId)).returning();
  for (const row of rows) await removeBotReaction(row.channelId, messageId, row.emoji);
}

export async function giveRole(userId: string, roleId: string): Promise<void> {
  await botFetch("PUT", `/guilds/${guildId()}/members/${userId}/roles/${roleId}`);
}

export async function takeRole(userId: string, roleId: string): Promise<void> {
  await botFetch("DELETE", `/guilds/${guildId()}/members/${userId}/roles/${roleId}`);
}
