import { and, asc, eq } from "drizzle-orm";
import { db } from "./client";
import { leagueAvailability, leagueEntries, leagueHeatEntries, leagueHeats } from "./schema";
import { applyManual, buildHeats, heatCount, type Heat, type HeatSeed } from "../leagueRules";
import type { League, LeagueEvent } from "./league";

/** One heat as it is stored, with who is in it. */
export type StoredHeat = { id: number; number: number; label: string | null; userIds: number[]; manual: Set<number> };

/**
 * The field for a round: everyone registered in the league who said they are
 * coming. Silence isn't a car and "not sure" isn't a confirmation either, so
 * neither is in here. Ordered by name, because the allocator deals equal-rated
 * drivers in the order they arrive and a rebuild has to give the same answer.
 */
export async function getHeatField(leagueId: number, eventId: number): Promise<HeatSeed[]> {
  return db
    .select({ userId: leagueEntries.userId, srBand: leagueEntries.srBand, drBand: leagueEntries.drBand })
    .from(leagueEntries)
    .innerJoin(leagueAvailability, and(eq(leagueAvailability.eventId, eventId), eq(leagueAvailability.userId, leagueEntries.userId)))
    .where(and(eq(leagueEntries.leagueId, leagueId), eq(leagueAvailability.status, "in")))
    .orderBy(asc(leagueEntries.id));
}

/** This round's heats, an emptied one included, lowest number first. */
export async function listHeats(eventId: number): Promise<StoredHeat[]> {
  const rows = await db.select().from(leagueHeats).where(eq(leagueHeats.eventId, eventId)).orderBy(asc(leagueHeats.number));
  if (!rows.length) return [];
  const entries = await db
    .select({ heatId: leagueHeatEntries.heatId, userId: leagueHeatEntries.userId, manual: leagueHeatEntries.manual })
    .from(leagueHeatEntries)
    .where(eq(leagueHeatEntries.eventId, eventId))
    // Insert order, which is the order the allocator dealt them, so a heat
    // reads quickest first instead of in whatever order Postgres hands back.
    .orderBy(asc(leagueHeatEntries.id));
  const heats = rows.map((row): StoredHeat => ({ id: row.id, number: row.number, label: row.label, userIds: [], manual: new Set() }));
  const byId = new Map(heats.map((heat) => [heat.id, heat]));
  for (const entry of entries) {
    const heat = byId.get(entry.heatId);
    if (!heat) continue;
    heat.userIds.push(entry.userId);
    if (entry.manual) heat.manual.add(entry.userId);
  }
  return heats;
}

/** Take this round's heats and everyone in them out. */
async function clearHeats(eventId: number) {
  await db.delete(leagueHeatEntries).where(eq(leagueHeatEntries.eventId, eventId));
  await db.delete(leagueHeats).where(eq(leagueHeats.eventId, eventId));
}

/**
 * Build or rebuild this round's heats from who said they are coming.
 *
 * The allocator gets the whole field and the drivers a moderator had already
 * placed by hand are then moved back, so fixing one heat doesn't get undone by
 * the next rebuild. Wiping and re-inserting is deliberate: the stored field ends
 * up exactly what this call decided rather than a merge of two decisions, and
 * the same input gives the same heats whoever runs it.
 *
 * A field that doesn't need splitting clears the heats instead of making one,
 * because a round with no heats is a single grid, which is what the rest of the
 * league code already assumes.
 */
export async function rebuildHeats(league: League, event: LeagueEvent): Promise<{ heats: Heat[]; field: number }> {
  const split = { maxCarsPerHeat: league.maxCarsPerHeat, minCarsPerHeat: league.minCarsPerHeat };
  const [pool, previous] = await Promise.all([getHeatField(league.id, event.id), listHeats(event.id)]);
  if (heatCount(pool.length, split) <= 1) {
    await clearHeats(event.id);
    return { heats: [], field: pool.length };
  }
  const inField = new Set(pool.map((driver) => driver.userId));
  const manual = previous.flatMap((heat) =>
    [...heat.manual].filter((userId) => inField.has(userId)).map((userId) => ({ userId, heatNumber: heat.number })),
  );
  const heats = applyManual(buildHeats(pool, split), manual);
  const manualUsers = new Set(manual.map((move) => move.userId));
  await db.transaction(async (tx) => {
    await tx.delete(leagueHeatEntries).where(eq(leagueHeatEntries.eventId, event.id));
    await tx.delete(leagueHeats).where(eq(leagueHeats.eventId, event.id));
    for (const heat of heats) {
      const [created] = await tx
        .insert(leagueHeats)
        .values({ eventId: event.id, number: heat.number })
        .returning({ id: leagueHeats.id });
      await tx.insert(leagueHeatEntries).values(
        heat.userIds.map((userId) => ({ eventId: event.id, heatId: created.id, userId, manual: manualUsers.has(userId) })),
      );
    }
  });
  return { heats, field: pool.length };
}

/**
 * Move a driver into another heat, or into the heats at all.
 *
 * Anything set here is flagged manual so a rebuild leaves it where it was put.
 * A driver who isn't in any heat can still be placed, which is the case where
 * somebody turns up on the night after saying not sure, or after the allocator
 * split a field without them.
 *
 * Returns the words to show the operator, or null when it worked.
 */
export async function moveHeatDriver(league: League, event: LeagueEvent, userId: number, heatNumber: number): Promise<string | null> {
  const heats = await listHeats(event.id);
  if (!heats.length) return "This round isn't split into heats yet.";
  const target = heats.find((heat) => heat.number === heatNumber);
  if (!target) return `There is no heat ${heatNumber} in this round.`;
  const current = heats.find((heat) => heat.userIds.includes(userId));
  if (current && current.id === target.id) return null;
  if (current) {
    await db
      .update(leagueHeatEntries)
      .set({ heatId: target.id, manual: true })
      .where(and(eq(leagueHeatEntries.eventId, event.id), eq(leagueHeatEntries.userId, userId)));
    return null;
  }
  const registered = await db.query.leagueEntries.findFirst({
    where: and(eq(leagueEntries.leagueId, league.id), eq(leagueEntries.userId, userId)),
    columns: { id: true },
  });
  if (!registered) return "That driver isn't registered in this league.";
  await db.insert(leagueHeatEntries).values({ eventId: event.id, heatId: target.id, userId, manual: true });
  return null;
}

/**
 * Delete one heat, leaving the rest numbered in order.
 *
 * Its drivers go with it rather than being spread into the other heats: whoever
 * deletes a heat is about to rebuild the field or place those people themselves,
 * and guessing which of the two is the one thing this can't do usefully. Results
 * already recorded against the heat are left in place with the heat taken off
 * them, which is what the `set null` on that column is for.
 */
export async function deleteHeat(event: LeagueEvent, heatId: number): Promise<{ number: number; drivers: number } | null> {
  const heats = await listHeats(event.id);
  const heat = heats.find((candidate) => candidate.id === heatId);
  if (!heat) return null;
  await db.transaction(async (tx) => {
    await tx.delete(leagueHeatEntries).where(and(eq(leagueHeatEntries.eventId, event.id), eq(leagueHeatEntries.heatId, heatId)));
    await tx.delete(leagueHeats).where(eq(leagueHeats.id, heatId));
    // Ascending, so each new number is at or below the old one and the unique
    // (event, number) index never sees two heats claiming the same slot.
    let next = 1;
    for (const remaining of heats.filter((candidate) => candidate.id !== heatId)) {
      if (remaining.number === next) { next += 1; continue; }
      await tx.update(leagueHeats).set({ number: next }).where(eq(leagueHeats.id, remaining.id));
      next += 1;
    }
  });
  return { number: heat.number, drivers: heat.userIds.length };
}
