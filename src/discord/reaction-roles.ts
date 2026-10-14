import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { reactionRoles } from "../db/schema";
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
  await db.delete(reactionRoles).where(eq(reactionRoles.id, id));
}

export async function giveRole(userId: string, roleId: string): Promise<void> {
  await botFetch("PUT", `/guilds/${guildId()}/members/${userId}/roles/${roleId}`);
}

export async function takeRole(userId: string, roleId: string): Promise<void> {
  await botFetch("DELETE", `/guilds/${guildId()}/members/${userId}/roles/${roleId}`);
}
