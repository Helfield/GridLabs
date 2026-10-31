// Which record changes get a line in the Discord channel, what the line
// says, and which cars count as the same class while doing it. See
// src/discord/leaderboard.ts and the class reading in src/classes.ts.
import { test, expect } from "bun:test";
import { isTakeover, takeoverAnnouncement, type Leader } from "../src/discord/leaderboard";
import { classDisplayName } from "../src/classes";
import { carClass, sameClass } from "../src/db/queries";

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

test("one physical class gets one board", () => {
  // The sim files the ELMS-spec prototype under its own token. It races as
  // an LMP2, so it must not have a second record alongside the real one.
  expect(carClass("LMP2 · IDEC Sport 2026 #28:LM")).toBe("LMP2");
  expect(carClass("LMP2_ELMS · IDEC Sport 2026 #28:LM")).toBe("LMP2");
  expect(carClass("LMP2_ELMS")).toBe("LMP2");
  // Hypercar reaches the site under four spellings, all one class.
  for (const raw of ["HYPER", "HYPERCAR", "LMH", "LMDH"]) {
    expect(carClass(`${raw} · Porsche 963 #6`)).toBe("HYPERCAR");
  }
  // Untouched classes stay as they were.
  expect(carClass("GT3 · Iron Lynx 2025 #63:ELMS")).toBe("GT3");
  expect(carClass("LMP3 · Duqueine #21")).toBe("LMP3");
  expect(carClass("GTE · Iron Dames #85")).toBe("GTE");
  expect(carClass("Ferrari 296 GT3 #63")).toBe("GT3");
  expect(carClass("Some Garage Car")).toBeNull();
});

test("the merged classes read as one name on the board", () => {
  expect(classDisplayName("LMP2")).toBe("LMP2");
  expect(classDisplayName("HYPERCAR")).toBe("Hypercar");
  // Rows stored before the merge keep the old token, so it must still read
  // as the class it became rather than a second one.
  expect(classDisplayName("LMP2_ELMS")).toBe("LMP2");
  expect(classDisplayName("LMDH")).toBe("Hypercar");
});

test("an ELMS-spec lap is a fair reference for an LMP2 both ways", () => {
  expect(sameClass("LMP2 · IDEC Sport 2026 #28:LM", "LMP2_ELMS · Algarve Pro #20")).toBe(true);
  expect(sameClass("LMP2_ELMS · Algarve Pro #20", "LMP2 · IDEC Sport 2026 #28:LM")).toBe(true);
  expect(sameClass("LMH · Porsche 963 #6", "HYPER · Cadillac V-Series.R #31")).toBe(true);
  // The merge must not let a slower class be measured against a faster one.
  expect(sameClass("GT3 · Iron Lynx 2025 #63:ELMS", "LMP2 · IDEC Sport 2026 #28:LM")).toBe(false);
  expect(sameClass("GT3 · Iron Lynx 2025 #63:ELMS", "GTE · Iron Dames #85")).toBe(false);
});
