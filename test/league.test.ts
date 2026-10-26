// The league's rules, in one file: which division a driver lands in, what a
// result is scored on, and what the desktop app's raw upload means as a grid.
// Nothing here touches the database -- src/leagueRules.ts and src/classes.ts
// hold no imports from either -- so every case runs without a connection.
import { test, expect, describe } from "bun:test";
import {
  LICENCE_BANDS,
  bandIndex,
  effectiveBand,
  qualifies,
  bandWindowText,
  scoringPosition,
  droppedRoundIds,
  rowsFromAppFinish,
  type AppFinish,
  type ResultRow,
} from "../src/leagueRules";
import { scoringClass } from "../src/classes";

// The two divisions as Grid Labs runs them: everyone at Silver 3 or below, and
// everyone at Gold 1 or above.
const SERIES_ONE = { bandMin: "Bronze 1", bandMax: "Silver 3" };
const SERIES_TWO = { bandMin: "Gold 1", bandMax: "Platinum 3" };
const OPEN = { bandMin: null, bandMax: null };

/** A driver the app saw crossing the line, `place` as the sim reported it. */
const row = (userId: number, place: number, carClass: string | null = null): AppFinish => ({
  userId,
  place,
  finished: true,
  disqualified: false,
  carClass,
});

describe("division by licence band", () => {
  test("the lower of SR and DR places the driver", () => {
    // Gold pace, Silver safety: the pass has to be made by both of them, so
    // this is a Series One driver until the SR catches up.
    expect(effectiveBand("Gold 2", "Silver 3")).toBe(bandIndex("Silver 3"));
    expect(qualifies(SERIES_TWO, { srBand: "Gold 2", drBand: "Silver 3" })).toBe(false);
    expect(qualifies(SERIES_ONE, { srBand: "Gold 2", drBand: "Silver 3" })).toBe(true);
  });

  test("both bands in the window gets you in", () => {
    expect(qualifies(SERIES_TWO, { srBand: "Gold 1", drBand: "Platinum 2" })).toBe(true);
    expect(qualifies(SERIES_ONE, { srBand: "Bronze 3", drBand: "Silver 1" })).toBe(true);
  });

  test("the cut falls between Silver 3 and Gold 1", () => {
    expect(LICENCE_BANDS.indexOf("Silver 3") + 1).toBe(LICENCE_BANDS.indexOf("Gold 1"));
    expect(qualifies(SERIES_ONE, { srBand: "Gold 1", drBand: "Gold 1" })).toBe(false);
    expect(qualifies(SERIES_TWO, { srBand: "Silver 3", drBand: "Silver 3" })).toBe(false);
  });

  test("nothing declared means nothing can be confirmed", () => {
    // Not even for the bottom division: declaring the bands is what makes the
    // gate work without a person on the door.
    expect(qualifies(SERIES_ONE, { srBand: null, drBand: null })).toBe(false);
    expect(qualifies(SERIES_ONE, { srBand: "Silver 2", drBand: null })).toBe(false);
    expect(effectiveBand(null, null)).toBe(-1);
  });

  test("an unrecognised band is the same as none", () => {
    expect(bandIndex("Gold 4")).toBe(-1);
    expect(bandIndex("  Silver 1  ")).toBe(bandIndex("Silver 1"));
  });

  test("a league with no window is open", () => {
    expect(qualifies(OPEN, { srBand: null, drBand: null })).toBe(true);
    expect(qualifies({ bandMin: null, bandMax: "Silver 3" }, { srBand: "Silver 3", drBand: "Silver 3" })).toBe(true);
    expect(qualifies({ bandMin: "Gold 1", bandMax: null }, { srBand: "Gold 1", drBand: "Gold 1" })).toBe(true);
  });

  test("the window reads as one line", () => {
    expect(bandWindowText(SERIES_ONE)).toBe("Bronze 1 to Silver 3");
    expect(bandWindowText({ bandMin: "Gold 1", bandMax: "Gold 1" })).toBe("Gold 1");
    expect(bandWindowText(OPEN)).toBe(null);
  });
});

describe("which place a result is scored on", () => {
  test("class place when there is one", () => {
    expect(scoringPosition({ position: 7, classPosition: 2 })).toBe(2);
    expect(scoringPosition({ position: 7, classPosition: null })).toBe(7);
    expect(scoringPosition({ position: 7 })).toBe(7);
  });
});

describe("dropped rounds", () => {
  // Rounds in calendar order, event ids 1..n, which is what getStandingBoards
  // hands droppedRoundIds.
  const whichRoundsAreDropped = (points: number[], dropped: number) =>
    droppedRoundIds(
      points.map((p, i) => ({ eventId: i + 1, points: p })),
      dropped,
    );
  const kept = (points: number[], dropped: number) => {
    const gone = whichRoundsAreDropped(points, dropped);
    return points.filter((_, i) => !gone.has(i + 1));
  };

  test("a 12-round season that drops 2 scores the best 10", () => {
    expect(kept([25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 18, 25], 2)).toEqual([25, 18, 15, 12, 10, 8, 6, 4, 18, 25]);
  });

  test("nobody is scored on zero rounds", () => {
    expect(kept([8, 25], 2)).toEqual([25]);
    expect(kept([8, 25], 9)).toEqual([25]);
  });

  test("a penalty is not a slow day, so it is never dropped", () => {
    // -10 came from the stewards. Dropping it would hand the driver a better
    // championship for being caught out.
    expect(kept([-10, 0, 25], 1)).toEqual([-10, 25]);
    expect(whichRoundsAreDropped([-10, -4], 2).size).toBe(0);
  });

  test("a DNF that scores nothing can be dropped", () => {
    expect(kept([25, 0, 18], 1)).toEqual([25, 18]);
  });

  test("two equal rounds drop the earlier one", () => {
    expect(kept([18, 18, 25], 1)).toEqual([18, 25]);
  });

  test("0 drops means every round counts", () => {
    expect(kept([1, 2, 3], 0)).toEqual([1, 2, 3]);
  });
});

describe("car class as a scoring class", () => {
  test("the two LMP2 specs score as one class", () => {
    expect(scoringClass("LMP2")).toBe("LMP2");
    expect(scoringClass("LMP2_ELMS")).toBe("LMP2");
    expect(scoringClass("lmp2_elms")).toBe("LMP2");
  });

  test("every hypercar name folds to one", () => {
    for (const raw of ["HYPER", "HYPERCAR", "LMH", "LMDH"]) expect(scoringClass(raw)).toBe("Hypercar");
  });

  test("a class we don't know stays unknown rather than being guessed", () => {
    expect(scoringClass("STOCK_CAR")).toBe(null);
    expect(scoringClass(null)).toBe(null);
  });
});

describe("filling a grid from the app", () => {
  const onFile: ResultRow[] = [
    { userId: 3, position: 1, classPosition: 1, carClass: "GT3", status: "finished", fastestLap: true, pole: true, adjustment: -3 },
    { userId: 9, position: 4, classPosition: null, carClass: null, status: "dns", fastestLap: false, pole: false, adjustment: 0 },
  ];

  test("the sim's lobby places become the league's running order", () => {
    // The sim saw these three as 4th, 7th and 9th of a 22-car lobby. The
    // league ran three cars, so it has a P1, a P2 and a P3.
    const rows = rowsFromAppFinish([row(1, 9), row(2, 4), row(3, 7)], []);
    expect(rows.map((r) => [r.userId, r.position]).sort((a, b) => a[0] - b[0])).toEqual([
      [1, 3],
      [2, 1],
      [3, 2],
    ]);
  });

  test("each class is numbered within itself", () => {
    const rows = rowsFromAppFinish([row(1, 2, "LMP2"), row(2, 5, "GT3"), row(3, 8, "LMP2"), row(4, 9, "GT3")], []);
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    expect([byUser.get(1)!.carClass, byUser.get(1)!.classPosition]).toEqual(["LMP2", 1]);
    expect([byUser.get(3)!.carClass, byUser.get(3)!.classPosition]).toEqual(["LMP2", 2]);
    expect([byUser.get(2)!.carClass, byUser.get(2)!.classPosition]).toEqual(["GT3", 1]);
    expect([byUser.get(4)!.carClass, byUser.get(4)!.classPosition]).toEqual(["GT3", 2]);
  });

  test("a car nobody recognises gets an overall place and no class", () => {
    const [r] = rowsFromAppFinish([row(1, 3, null)], []);
    expect([r.position, r.carClass, r.classPosition]).toEqual([1, null, null]);
  });

  test("a retirement is a retirement, and takes no place", () => {
    const rows = rowsFromAppFinish(
      [
        { userId: 1, place: 3, finished: false, disqualified: false, carClass: "GT3" },
        { userId: 2, place: 4, finished: false, disqualified: true, carClass: "GT3" },
        row(3, 6, "GT3"),
      ],
      [],
    );
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    expect([byUser.get(1)!.status, byUser.get(1)!.position, byUser.get(1)!.classPosition]).toEqual(["dnf", null, null]);
    expect([byUser.get(2)!.status, byUser.get(2)!.position]).toEqual(["dsq", null]);
    // The only finisher is P1 overall and P1 in class, whatever the lobby said.
    expect([byUser.get(3)!.position, byUser.get(3)!.classPosition]).toEqual([1, 1]);
  });

  test("every row the app never saw is left exactly as it was", () => {
    const rows = rowsFromAppFinish([row(1, 4, "GT3")], onFile);
    for (const userId of [3, 9]) {
      const kept = rows.find((r) => r.userId === userId)!;
      expect(kept).toEqual(onFile.find((r) => r.userId === userId)!);
    }
    expect(rows).toHaveLength(3);
  });

  test("pole, fastest lap and a penalty survive a re-fill", () => {
    const rows = rowsFromAppFinish([row(3, 4, "GT3")], onFile);
    const r = rows.find((x) => x.userId === 3)!;
    expect([r.pole, r.fastestLap, r.adjustment, r.position, r.classPosition]).toEqual([true, true, -3, 1, 1]);
  });
});
