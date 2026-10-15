import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { botSettings } from "../db/schema";

// Read on every voice event, so a short cache keeps that off the database;
// writes through here update it immediately.
const TTL_MS = 15_000;
const cache = new Map<string, { value: string | null; at: number }>();

export async function getSetting(key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const [row] = await db.select().from(botSettings).where(eq(botSettings.key, key)).limit(1);
  const value = row?.value ?? null;
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(botSettings).values({ key, value }).onConflictDoUpdate({ target: botSettings.key, set: { value } });
  cache.set(key, { value, at: Date.now() });
}

export async function clearSetting(key: string): Promise<void> {
  await db.delete(botSettings).where(eq(botSettings.key, key));
  cache.set(key, { value: null, at: Date.now() });
}
