// The league's rules, in one file: which division a driver lands in, what a
// result is scored on, what the desktop app's raw upload means as a grid, and
// how a field too big for one grid is split into heats.
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
  rsvpClosesAt,
  rsvpOpen,
  countAttendance,
  rowsFromAppFinish,
  heatCount,
  buildHeats,
  applyManual,
  heatLabel,
  type AppFinish,
  type ResultRow,
  type HeatSeed,
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

describe("marking attendance", () => {
  const at = (iso: string) => new Date(iso);
  const race = at("2026-11-07T20:00:00Z");

  test("closes the set number of hours before the race", () => {
    expect(rsvpClosesAt(race, 24)?.toISOString()).toBe("2026-11-06T20:00:00.000Z");
    expect(rsvpClosesAt(race, 0)?.toISOString()).toBe("2026-11-07T20:00:00.000Z");
  });

  test("a round with no date has no deadline", () => {
    expect(rsvpClosesAt(null, 24)).toBeNull();
    expect(rsvpOpen(null, 24, at("2030-01-01T00:00:00Z"))).toBe(true);
  });

  test("open up to the deadline and closed from it", () => {
    expect(rsvpOpen(race, 24, at("2026-11-06T19:59:00Z"))).toBe(true);
    expect(rsvpOpen(race, 24, at("2026-11-06T20:00:00Z"))).toBe(false);
    expect(rsvpOpen(race, 24, at("2026-11-06T20:01:00Z"))).toBe(false);
  });

  test("everyone registered who hasn't answered is counted as not marked", () => {
    const counts = countAttendance(
      [1, 2, 3, 4],
      [
        { userId: 1, status: "in" },
        { userId: 2, status: "maybe" },
        { userId: 3, status: "out" },
      ],
    );
    expect(counts).toEqual({ in: 1, maybe: 1, out: 1, answered: 3, unmarked: 1 });
  });

  test("an answer from a driver who isn't registered isn't a car", () => {
    const counts = countAttendance([1], [
      { userId: 1, status: "in" },
      { userId: 99, status: "in" },
    ]);
    expect(counts.in).toBe(1);
    expect(counts.unmarked).toBe(0);
  });

  test("a driver only counts once however many rows they have", () => {
    const counts = countAttendance(
      [1, 2],
      [
        { userId: 1, status: "in" },
        { userId: 1, status: "out" },
      ],
    );
    expect(counts).toEqual({ in: 1, maybe: 0, out: 0, answered: 1, unmarked: 1 });
  });
});

describe("splitting a field into heats", () => {
  // 26 cars max and 8 min, the settings a new league gets.
  const SPLIT = { maxCarsPerHeat: 26, minCarsPerHeat: 8 };

  /** A field built from [band, count] pairs, fastest band first. */
  const field = (...groups: Array<[string, number]>) => {
    const pool: HeatSeed[] = [];
    for (const [band, count] of groups) {
      for (let i = 0; i < count; i++) pool.push({ userId: pool.length + 1, srBand: band, drBand: band });
    }
    return pool;
  };
  const sizes = (pool: HeatSeed[], split = SPLIT) => buildHeats(pool, split).map((h) => h.userIds.length);
  const bandsOf = (userId: number, pool: HeatSeed[]) => {
    const d = pool.find((p) => p.userId === userId)!;
    const at = effectiveBand(d.srBand, d.drBand);
    return at < 0 ? null : LICENCE_BANDS[at];
  };
  const rankOf = (userId: number, pool: HeatSeed[]) => {
    const band = bandsOf(userId, pool);
    return band ? LICENCE_BANDS.indexOf(band) : -1;
  };

  test("a field that fits is one grid and no heats", () => {
    expect(sizes(field(["Gold 2", 26]))).toEqual([26]);
    expect(sizes(field(["Gold 2", 1]))).toEqual([1]);
    expect(buildHeats([], SPLIT)).toEqual([]);
  });

  test("one car over the cap splits evenly rather than 26 and 1", () => {
    expect(sizes(field(["Gold 2", 27]))).toEqual([14, 13]);
    expect(heatCount(27, SPLIT)).toBe(2);
  });

  test("the field fills each heat before starting the next", () => {
    expect(sizes(field(["Gold 2", 52]))).toEqual([26, 26]);
    expect(sizes(field(["Gold 2", 78]))).toEqual([26, 26, 26]);
    // 53 doesn't make a 1-car third heat: three heats of 18 is the best split.
    expect(sizes(field(["Gold 2", 53]))).toEqual([18, 18, 17]);
  });

  test("a split that would leave a heat under the minimum is refused", () => {
    // 15 cars at 8 a heat would want 2 heats of 8 and 7, and 7 is under the
    // floor. One long grid is better than one thin heat.
    expect(sizes(field(["Gold 2", 15]))).toEqual([15]);
    expect(heatCount(15, SPLIT)).toBe(1);
    // The same field with a lower floor does split.
    expect(sizes(field(["Gold 2", 15]), { maxCarsPerHeat: 8, minCarsPerHeat: 7 })).toEqual([8, 7]);
    // 30 at 26 a heat wants 2, and 15 each clears the floor easily.
    expect(sizes(field(["Gold 2", 30]))).toEqual([15, 15]);
  });

  test("sizes never differ by more than one car", () => {
    for (const n of [27, 40, 53, 61, 79, 100]) {
      const got = sizes(field(["Gold 2", n]));
      expect(Math.max(...got) - Math.min(...got)).toBeLessThanOrEqual(1);
      expect(got.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.max(...got)).toBeLessThanOrEqual(SPLIT.maxCarsPerHeat);
    }
  });

  test("a heat is one ability group, not a mix", () => {
    const pool = field(["Platinum 1", 15], ["Bronze 1", 15]);
    const heats = buildHeats(pool, SPLIT);
    expect(heats).toHaveLength(2);
    expect(heats[0].userIds.every((u) => bandsOf(u, pool) === "Platinum 1")).toBe(true);
    expect(heats[1].userIds.every((u) => bandsOf(u, pool) === "Bronze 1")).toBe(true);
  });

  test("the top heat fills before the quicker band spills into the next", () => {
    // 20 Platinum and 10 Gold into 2 heats of 15: heat A is all Platinum, and
    // the 5 Platinum that don't fit race the Golds rather than a heat being
    // built out of half of each band.
    const pool = field(["Platinum 1", 20], ["Gold 1", 10]);
    const heats = buildHeats(pool, SPLIT);
    expect(heats.map((h) => h.userIds.map((u) => bandsOf(u, pool)))).toEqual([
      Array(15).fill("Platinum 1"),
      [...Array(5).fill("Platinum 1"), ...Array(10).fill("Gold 1")],
    ]);
  });

  test("a middle band splits between the heats on either side of it", () => {
    const pool = field(["Platinum 3", 10], ["Gold 2", 10], ["Bronze 2", 10]);
    // 10 Plat can't fill a 15-car heat, so 5 Gold join them and the other 5
    // drop to the bottom heat with the 10 Bronzes.
    expect(buildHeats(pool, SPLIT).map((h) => h.userIds.map((u) => bandsOf(u, pool)))).toEqual([
      [...Array(10).fill("Platinum 3"), ...Array(5).fill("Gold 2")],
      [...Array(5).fill("Gold 2"), ...Array(10).fill("Bronze 2")],
    ]);
  });

  test("nobody who declared no band ends up at the top", () => {
    const pool = field(["Platinum 1", 15], ["Bronze 1", 15]);
    for (const d of pool.slice(15)) {
      d.srBand = null;
      d.drBand = null;
    }
    const heats = buildHeats(pool, SPLIT);
    expect(heats[1].userIds.every((u) => bandsOf(u, pool) === null)).toBe(true);
  });

  test("equal-rated drivers are dealt in rotation, not in blocks off the entry list", () => {
    // 30 identical drivers. Any 15/15 split is fair on pace, so the one that
    // isn't "whoever registered first" is the one worth having.
    const heats = buildHeats(field(["Gold 2", 30]), SPLIT);
    expect(heats[0].userIds).not.toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(heats[0].userIds).toEqual(Array.from({ length: 15 }, (_, i) => i * 2 + 1));
    expect(heats[1].userIds).toEqual(Array.from({ length: 15 }, (_, i) => i * 2 + 2));
  });

  test("each heat is listed quickest first", () => {
    const pool = field(["Platinum 1", 20], ["Gold 2", 15], ["Bronze 1", 10]);
    for (const heat of buildHeats(pool, SPLIT)) {
      const ranks = heat.userIds.map((u) => rankOf(u, pool));
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    }
  });

  test("the rebuild is the same call on the same field", () => {
    const pool = field(["Gold 1", 9], ["Silver 2", 11], ["Bronze 3", 12]);
    expect(buildHeats(pool, SPLIT)).toEqual(buildHeats([...pool].reverse(), SPLIT));
  });

  test("heats are lettered from A", () => {
    expect(heatLabel(1)).toBe("Heat A");
    expect(heatLabel(2)).toBe("Heat B");
    expect(heatLabel(3)).toBe("Heat C");
  });
});

describe("moving drivers between heats by hand", () => {
  const SPLIT = { maxCarsPerHeat: 26, minCarsPerHeat: 8 };
  const pool: HeatSeed[] = Array.from({ length: 30 }, (_, i) => ({ userId: i + 1, srBand: "Gold 2", drBand: "Gold 2" }));
  const allocated = buildHeats(pool, SPLIT);

  test("a field nobody has touched is handed back as it was", () => {
    expect(applyManual(allocated, [])).toEqual(allocated);
  });

  test("a moved driver joins the bottom of the heat they were put in", () => {
    // Bottom, not sorted in: the allocator already ordered the heat by pace, and
    // a moderator's move says nothing about this driver's rating.
    const moved = applyManual(allocated, [{ userId: 1, heatNumber: 2 }]);
    expect(moved[0].userIds).not.toContain(1);
    expect(moved[1].userIds).toContain(1);
    expect(moved[1].userIds[moved[1].userIds.length - 1]).toBe(1);
    expect(moved.map((h) => h.userIds.length)).toEqual([14, 16]);
  });

  test("moving a driver into the heat they are already in changes nothing", () => {
    expect(applyManual(allocated, [{ userId: 1, heatNumber: 1 }])).toEqual(allocated);
  });

  test("a heat number past the last heat means the last one", () => {
    // The panel offers the heats that exist, so an out-of-range number is an old
    // bookmark or a race against a rebuild. Placing the driver somewhere beats
    // an error that leaves them nowhere.
    const moved = applyManual(allocated, [{ userId: 1, heatNumber: 9 }]);
    expect(moved.map((h) => h.userIds.length)).toEqual([14, 16]);
    expect(moved[1].userIds[moved[1].userIds.length - 1]).toBe(1);
  });

  test("the last driver leaving a heat takes the heat with them", () => {
    const one = [{ number: 1, userIds: [1, 2] }, { number: 2, userIds: [3] }];
    expect(applyManual(one, [{ userId: 3, heatNumber: 1 }])).toEqual([{ number: 1, userIds: [1, 2, 3] }]);
  });

  test("a driver who is no longer in the field is not put anywhere", () => {
    // Somebody who withdrew since the move is recorded. RebuildHeats filters
    // these out before calling, and this is the same answer if it doesn't.
    expect(applyManual(allocated, [{ userId: 999, heatNumber: 2 }])).toEqual(allocated);
  });

  test("several moves are applied in the order they were made", () => {
    const moved = applyManual(allocated, [
      { userId: 1, heatNumber: 2 },
      { userId: 2, heatNumber: 1 },
    ]);
    expect(moved[0].userIds).toEqual([3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 2]);
    expect(moved[1].userIds).toEqual([4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 1]);
    expect(moved.map((h) => h.userIds.length)).toEqual([15, 15]);
  });
});
