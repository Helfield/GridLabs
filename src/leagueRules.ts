/**
 * The rules a league is played by: who may register for it, and what a
 * result is worth. Pure on purpose -- no database, no views, no imports from
 * either -- so the desktop app's contract-test style applies here too and
 * test/league.test.ts can run every case in this file without a connection.
 *
 * Reading the database and writing it both live in src/db/league.ts, which
 * calls in here for the decisions.
 */

/** LMU licence bands for SR and DR, lowest to highest. What registration offers as choices. */
export const LICENCE_BANDS: string[] = [
  "Bronze 1",
  "Bronze 2",
  "Bronze 3",
  "Silver 1",
  "Silver 2",
  "Silver 3",
  "Gold 1",
  "Gold 2",
  "Gold 3",
  "Platinum 1",
  "Platinum 2",
  "Platinum 3",
];

/** Below three cars a class is a procession, not a championship. */
export const MIN_CLASS_SIZE = 3;

/**
 * Where a band sits in LICENCE_BANDS, lowest to highest. Blank or unrecognised
 * is -1, below every real band, which is what puts an under-declared driver in
 * the bottom division instead of the top one.
 */
export function bandIndex(band: string | null | undefined): number {
  if (!band) return -1;
  return LICENCE_BANDS.indexOf(band.trim());
}

/**
 * The band a league places a driver in: the LOWER of their SR and DR. A Gold
 * pace with a Silver safety rating belongs among the Silver drivers, because
 * the top division is where a prototype arrives at a corner alongside a GT3
 * and the pass has to be made by both of them.
 */
export function effectiveBand(srBand: string | null, drBand: string | null): number {
  return Math.min(bandIndex(srBand), bandIndex(drBand));
}

export type BandWindow = { bandMin: string | null; bandMax: string | null };

/**
 * May this driver register? A league with no window is open to everyone,
 * which is every league that existed before windows were a thing.
 *
 * Inside a windowed league a driver with a blank band does not qualify, even
 * for the lowest division: declaring a licence is the price of the gate being
 * unstaffed. Someone who genuinely doesn't know goes to a moderator, who can
 * add them and record their bands afterwards.
 */
export function qualifies(league: BandWindow, driver: { srBand: string | null; drBand: string | null }): boolean {
  if (!league.bandMin && !league.bandMax) return true;
  const min = league.bandMin ? bandIndex(league.bandMin) : 0;
  const max = league.bandMax ? bandIndex(league.bandMax) : LICENCE_BANDS.length - 1;
  const band = effectiveBand(driver.srBand, driver.drBand);
  return band >= min && band <= max;
}

/** "Silver 1 to Silver 3", or null when the league is open to everyone. */
export function bandWindowText(league: BandWindow): string | null {
  if (!league.bandMin && !league.bandMax) return null;
  const min = league.bandMin ?? LICENCE_BANDS[0];
  const max = league.bandMax ?? LICENCE_BANDS[LICENCE_BANDS.length - 1];
  return min === max ? min : `${min} to ${max}`;
}

/**
 * What the driver's licence has to be, said to someone who just got turned
 * away at the door.
 */
export function notQualifiedMessage(league: BandWindow): string {
  const window = bandWindowText(league);
  return `This league is for ${window ?? "every band"}. Check your SR and DR bands in LMU's licence screen, or ask a moderator to add you.`;
}

export type ResultRow = {
  userId: number;
  position: number | null;
  classPosition: number | null;
  carClass: string | null;
  status: "finished" | "dnf" | "dns" | "dsq";
  fastestLap: boolean;
  pole: boolean;
  adjustment: number;
};

/**
 * The place a result is scored on: the class place when the race was
 * mixed-class, the overall place otherwise.
 *
 * One rule used by the save, the re-score and the championship table, so a
 * stored `points` value and the table can't disagree about which column the
 * points came from.
 */
export function scoringPosition(r: { position: number | null; classPosition?: number | null }): number | null {
  return r.classPosition ?? r.position;
}

/**
 * The rounds a driver's score is NOT taken from.
 *
 * A season scores its best results, so the worst `dropped` of a driver's rounds
 * leave the total and one bad night doesn't decide the title. Three things the
 * callers can't get from a naive "drop the lowest":
 *
 * - At least one round always counts. Someone who ran 2 of 12 in a league that
 *   drops 2 still has a score, not a zero for having entered.
 * - A negative round is a stewards' penalty rather than a slow day, so it is
 *   never dropped. If it were, taking a time penalty would improve your
 *   championship.
 * - Pass the rounds in calendar order. The sort is stable, so when two rounds
 *   score the same it is the earlier one that goes and recent form stands.
 */
export function droppedRoundIds(scores: Array<{ eventId: number; points: number }>, dropped: number): Set<number> {
  const droppable = scores.filter((s) => s.points >= 0);
  const count = Math.max(0, Math.min(Math.max(dropped, 0), droppable.length - 1));
  return new Set(
    droppable
      .sort((a, b) => a.points - b.points)
      .slice(0, count)
      .map((s) => s.eventId),
  );
}

/**
 * What a driver can say about coming to a round. There is deliberately no
 * value for "hasn't said anything": that is the absence of a row, it is
 * counted apart from a not-sure, and once marking closes it means not racing.
 */
export const ATTENDANCE_STATUSES = ["in", "out", "maybe"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** How each answer is worded to a person. */
export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  in: "Coming",
  maybe: "Not sure",
  out: "Not coming",
};

/**
 * When marking closes for a round: its start less the league's hours. A round
 * with no date has no deadline and stays open, because a blank date means the
 * fixture isn't finished rather than that the race is tonight.
 */
export function rsvpClosesAt(eventDate: Date | null, hoursBefore: number): Date | null {
  if (!eventDate) return null;
  return new Date(eventDate.getTime() - Math.max(0, hoursBefore) * 3600 * 1000);
}

/** Whether a driver can still change their own answer. Staff can after this. */
export function rsvpOpen(eventDate: Date | null, hoursBefore: number, now: Date): boolean {
  const closes = rsvpClosesAt(eventDate, hoursBefore);
  return closes === null || now.getTime() < closes.getTime();
}

export type AttendanceCounts = { in: number; maybe: number; out: number; answered: number; unmarked: number };

/**
 * Tally one round. Both sides are passed in because the entry list is what
 * decides who counts: a driver who withdrew can leave an old answer sitting in
 * the table, and an answer from someone who isn't entered is not a car.
 */
export function countAttendance(
  registeredUserIds: Iterable<number>,
  answers: Array<{ userId: number; status: AttendanceStatus }>,
): AttendanceCounts {
  const entered = new Set(registeredUserIds);
  const counts: AttendanceCounts = { in: 0, maybe: 0, out: 0, answered: 0, unmarked: 0 };
  const seen = new Set<number>();
  for (const a of answers) {
    if (!entered.has(a.userId) || seen.has(a.userId)) continue;
    if (!ATTENDANCE_STATUSES.includes(a.status)) continue;
    seen.add(a.userId);
    counts[a.status] += 1;
  }
  counts.answered = seen.size;
  counts.unmarked = Math.max(0, entered.size - counts.answered);
  return counts;
}

export type AppFinish = {
  userId: number;
  /** The place the sim reported, across its whole lobby. */
  place: number;
  finished: boolean;
  disqualified: boolean;
  /** Already folded into a scoring class, or null if the car wasn't identified. */
  carClass: string | null;
};

/**
 * Turn what the desktop app recorded into a results grid.
 *
 * Two jobs here that the raw upload can't do. The sim reports place across
 * its whole lobby, so an LMP2 who finished 4th of 22 in a race the league
 * called 12 cars was P4 in a 12-car table: the reported places are used as an
 * ORDER and the grid numbers come from ranking the league's own drivers
 * against each other. And a class place only exists within a class, so each
 * class is numbered on its own from the same order.
 *
 * Rows already on file that the app didn't see are returned untouched. A
 * driver who races without the app, or whose app lost the session, keeps
 * whatever the organisers typed in for them.
 *
 * Pole, fastest lap and any penalty carry over from the row on file: the app
 * reports neither, and a re-score would otherwise quietly wipe a stewards'
 * decision.
 */
export function rowsFromAppFinish(app: AppFinish[], onFile: ResultRow[]): ResultRow[] {
  const previous = new Map(onFile.map((r) => [r.userId, r]));
  const carried = (userId: number) => {
    const p = previous.get(userId);
    return { pole: p?.pole ?? false, fastestLap: p?.fastestLap ?? false, adjustment: p?.adjustment ?? 0 };
  };
  const rows = new Map<number, ResultRow>();

  const finishers = app
    .filter((a) => a.finished)
    .sort((a, b) => a.place - b.place);
  const perClass = new Map<string, number>();
  for (let i = 0; i < finishers.length; i++) {
    const a = finishers[i];
    let classPosition: number | null = null;
    if (a.carClass) {
      classPosition = (perClass.get(a.carClass) ?? 0) + 1;
      perClass.set(a.carClass, classPosition);
    }
    rows.set(a.userId, {
      userId: a.userId,
      status: "finished",
      position: i + 1,
      carClass: a.carClass,
      classPosition,
      ...carried(a.userId),
    });
  }
  for (const a of app) {
    if (rows.has(a.userId)) continue;
    rows.set(a.userId, {
      userId: a.userId,
      status: a.disqualified ? "dsq" : "dnf",
      position: null,
      classPosition: null,
      carClass: a.carClass,
      ...carried(a.userId),
    });
  }
  for (const r of onFile) {
    if (!rows.has(r.userId)) rows.set(r.userId, r);
  }
  return [...rows.values()];
}

/** Who the field is being built from, and how big a heat may be. */
export type HeatSeed = { userId: number; srBand: string | null; drBand: string | null };
export type HeatSplit = { maxCarsPerHeat: number; minCarsPerHeat: number };
export type Heat = { number: number; userIds: number[] };

/**
 * How many heats a field of n cars needs.
 *
 * The max sets the starting point and the min pulls it back down, one heat at a
 * time: 30 cars at 26 a heat wants 2 heats of 15, which clears a floor of 8 and
 * stays 2. The same field with a floor of 16 doesn't, and goes back to one grid
 * of 30. Only ever going down, because every heat counts for the championship
 * and a thin heat is worse for the people stuck in it than a long single grid.
 */
export function heatCount(n: number, split: HeatSplit): number {
  if (n <= 0) return 0;
  const max = Math.max(1, split.maxCarsPerHeat);
  const min = Math.max(1, split.minCarsPerHeat);
  let k = Math.ceil(n / max);
  while (k > 1 && Math.floor(n / k) < min) k -= 1;
  return k;
}

/**
 * Split the field into ability groups: similar ratings inside each heat, so a
 * Bronze 2 doesn't spend a race being lapped by Prototypes.
 *
 * Everyone is ranked by their league band (the lower of SR and DR, which is how
 * divisions are decided everywhere else here) and dealt from the top, so heat 1
 * is the quickest group. Sizes differ by at most one car, the odd driver going
 * to the top heat, and the whole thing collapses to a single grid when a split
 * would leave a heat under the minimum.
 *
 * The two rules pull against each other where a heat is cut: equal sizes can't
 * also land on a band line, so a heat straddling a boundary holds the leftover
 * cars of one band plus the band below it. 30 Platinum and 22 Bronze split into
 * heats of 26 makes one heat all Platinum and the other 4 Platinum with 22
 * Bronze. Those are adjacent bands, and the alternative to mixing them is a
 * 4-car heat. Where the counts land badly a moderator moves people by hand,
 * which is what `manual` on the entry is for.
 *
 * Equal-rated drivers are handed out in rotation across the heats a band is
 * split between, so a heat doesn't collect one contiguous block of the entry
 * list: 30 identical drivers over 2 heats means both get every other name
 * rather than one getting the first fifteen.
 *
 * Nothing here is stored and nothing here knows about a round. The caller saves
 * the result into league_heats / league_heat_entries; a rebuild is this same
 * call, so it gives the same answer whoever runs it.
 */
export function buildHeats(pool: HeatSeed[], split: HeatSplit): Heat[] {
  const k = heatCount(pool.length, split);
  if (k === 0) return [];
  const sizes: number[] = [];
  const base = Math.floor(pool.length / k);
  const extra = pool.length % k;
  for (let i = 0; i < k; i++) sizes.push(base + (i < extra ? 1 : 0));

  const heats: Heat[] = sizes.map((_, i) => ({ number: i + 1, userIds: [] }));
  const remaining = [...sizes];

  const ranked = [...pool].sort((a, b) => {
    const diff = effectiveBand(b.srBand, b.drBand) - effectiveBand(a.srBand, a.drBand);
    return diff !== 0 ? diff : a.userId - b.userId;
  });

  // Maximal runs of the same band, fastest band first.
  for (let start = 0; start < ranked.length; ) {
    const band = effectiveBand(ranked[start].srBand, ranked[start].drBand);
    let end = start;
    while (end < ranked.length && effectiveBand(ranked[end].srBand, ranked[end].drBand) === band) end += 1;
    const group = ranked.slice(start, end);

    // How many of this group each heat gets, filling from the top: heat 1 takes
    // all it can before heat 2 is touched. That is what makes the heats ability
    // groups rather than a smear of every band in each one, and it means a group
    // only reaches a lower heat once every heat above it is full.
    const take = new Array<number>(k).fill(0);
    let left = group.length;
    for (let h = 0; h < k && left > 0; h++) {
      const n = Math.min(remaining[h], left);
      take[h] = n;
      remaining[h] -= n;
      left -= n;
    }

    // Hand the group out to those heats one at a time, always to whichever still
    // wants the most. The counts come out exactly as above, but equal-rated
    // drivers arrive in rotation instead of in one block off the entry list, so
    // the top heat doesn't automatically collect whoever registered first.
    const wants = [...take];
    for (const driver of group) {
      let best = -1;
      for (let h = 0; h < k; h++) if (wants[h] > 0 && (best < 0 || wants[h] > wants[best])) best = h;
      if (best < 0) break;
      heats[best].userIds.push(driver.userId);
      wants[best] -= 1;
    }
    start = end;
  }

  // Each heat listed quickest-first, the same order the pool was dealt from.
  const rankOf = new Map(ranked.map((d, i) => [d.userId, i]));
  return heats
    .filter((h) => h.userIds.length > 0)
    .map((h) => ({ ...h, userIds: [...h.userIds].sort((a, b) => rankOf.get(a)! - rankOf.get(b)!) }));
}

/**
 * Put back the drivers a moderator placed by hand, once the allocator has run.
 *
 * buildHeats() only knows the field and the bands, so a rebuild on its own would
 * undo every override made when it got one wrong. This runs on its result rather
 * than on the pool, because a hand placement must not change how many heats there
 * are or who else the allocator picked: the driver is lifted out of wherever it
 * put them and dropped at the bottom of the heat they were moved to.
 *
 * A target heat the new field no longer needs sends them to the highest one below
 * it, and a driver who is no longer in the field is left out, because the smaller
 * field is what it is. Numbers are re-assigned afterwards, since a move can empty
 * a heat and a heat nobody is in isn't a race.
 */
export function applyManual(allocated: Heat[], manual: Array<{ userId: number; heatNumber: number }>): Heat[] {
  if (!allocated.length || !manual.length) return allocated;
  const order = allocated.map((h) => h.number).sort((a, b) => a - b);
  const groups = new Map(allocated.map((h) => [h.number, [...h.userIds]]));
  for (const move of manual) {
    const from = order.find((n) => groups.get(n)!.includes(move.userId));
    if (from === undefined) continue;
    let target = order[0];
    for (const n of order) if (n <= move.heatNumber) target = n;
    if (target === from) continue;
    groups.set(from, groups.get(from)!.filter((u) => u !== move.userId));
    groups.get(target)!.push(move.userId);
  }
  return order.filter((n) => groups.get(n)!.length > 0).map((n, i) => ({ number: i + 1, userIds: groups.get(n)! }));
}

/** "Heat A", for the 1-based number a heat carries. */
/** Just the letter, for a control with no room for the word "Heat". */
export function heatLetter(number: number): string {
  return number >= 1 && number <= 26 ? String.fromCharCode(64 + number) : String(number);
}

export function heatLabel(number: number): string {
  return `Heat ${heatLetter(number)}`;
}
