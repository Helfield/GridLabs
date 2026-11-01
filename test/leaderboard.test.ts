// Which record changes get a line in the Discord channel, and what the
// line says. See src/discord/leaderboard.ts.
import { test, expect } from "bun:test";
import { isTakeover, takeoverAnnouncement, type Leader } from "../src/discord/leaderboard";

const holder = (userId: number, name: string, lapTimeSeconds: number): Leader => ({ userId, name, lapTimeSeconds });

test("only a record taken from someone else is announced", () => {
  // The driver who already held it goes faster: the board updates, the
  // channel stays quiet. This was most of what used to be posted.
  expect(isTakeover(holder(7, "Ben Thorley", 70.0), holder(7, "Ben Thorley", 69.5))).toBe(false);
  // Someone else's record, beaten.
  expect(isTakeover(holder(7, "Ben Thorley", 70.0), holder(9, "Alex J King", 69.5))).toBe(true);
  // Nothing held the class before, so nothing was taken.
  expect(isTakeover(undefined, holder(9, "Alex J King", 69.5))).toBe(false);
  // Same time, or a slower one: not a record being beaten.
  expect(isTakeover(holder(7, "Ben Thorley", 70.0), holder(9, "Alex J King", 70.0))).toBe(false);
  expect(isTakeover(holder(7, "Ben Thorley", 70.0), holder(9, "Alex J King", 70.4))).toBe(false);
});

test("the announcement names the driver whose record was taken", () => {
  expect(
    takeoverAnnouncement(
      "Circuit de la Sarthe",
      "LMP2",
      holder(9, "Alex J King", 100.0),
      holder(7, "Ben Thorley", 100.5),
    ),
  ).toBe(
    "🏆 **New fastest LMP2 lap at Circuit de la Sarthe:** `1:40.000` by **Alex J King** — beats Ben Thorley's `1:40.500` by 0.500s",
  );
});
