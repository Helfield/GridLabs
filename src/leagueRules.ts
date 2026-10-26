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
