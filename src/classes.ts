/**
 * Car-class naming, shared by the database queries, the library pages
 * and the Discord leaderboard. Pure -- no database or view imports -- so
 * anything can use it.
 *
 * The keys are what carClass() (db/queries.ts) extracts from the app's
 * "<class> · <entry>" car names, upper-cased. The values seen in real
 * uploads are HYPER, LMP2, LMP2_ELMS, LMP3, GTE and GT3; the others
 * are here so a class the sim adds later still sorts and reads sensibly.
 */

export const UNCLASSIFIED = "UNCLASSIFIED";

// As a timing screen would list them: fastest cars first.
const CLASS_ORDER = ["HYPER", "HYPERCAR", "LMH", "LMDH", "LMP2", "LMP2_ELMS", "LMP3", "GTE", "GT3", "GT4"];

const DISPLAY_NAMES: Record<string, string> = {
  HYPER: "Hypercar",
  HYPERCAR: "Hypercar",
  LMDH: "LMDh",
  LMP2_ELMS: "LMP2 (ELMS)",
  [UNCLASSIFIED]: "Unclassified",
};

export function classRank(cls: string): number {
  if (cls === UNCLASSIFIED) return 1000;
  const i = CLASS_ORDER.indexOf(cls);
  return i === -1 ? 100 : i;
}

export function classDisplayName(cls: string): string {
  return DISPLAY_NAMES[cls] ?? cls;
}

/**
 * The class a league scores a car in, which is coarser than the sim's own
 * naming. "LMP2" and "LMP2_ELMS" are two specs on the timing screen but they
 * arrive at a corner close enough to race as one group, and scoring them
 * apart would hand a season to whoever brought the ELMS spec. A league entry
 * uses this name; the leaderboards keep using the raw token, where the two
 * genuinely are different cars on different pace.
 */
const SCORING_NAMES: Record<string, string> = {
  HYPER: "Hypercar",
  HYPERCAR: "Hypercar",
  LMH: "Hypercar",
  LMDH: "Hypercar",
  LMP2: "LMP2",
  LMP2_ELMS: "LMP2",
  LMP3: "LMP3",
  GTE: "GTE",
  GT3: "GT3",
  GT4: "GT4",
};

// Fastest to slowest. This is the list a stored result's class is checked
// against, so it has to cover every class the scoring names can produce,
// including the one no Grid Labs series currently runs.
export const SCORING_CLASSES = ["Hypercar", "LMP2", "LMP3", "GTE", "GT3", "GT4"];

/**
 * The classes a league runs. Grid Labs' series excludes Hypercar; that's a
 * choice about entries, written in the sporting doc, not something the code
 * should enforce, because a stored result naming a class missing from this
 * list would be impossible to re-save.
 */
export const LEAGUE_CLASSES = ["LMP2", "LMP3", "GTE", "GT3", "GT4"];

/** The scoring class for a raw class token, or null if it isn't one we know. */
export function scoringClass(cls: string | null | undefined): string | null {
  if (!cls) return null;
  return SCORING_NAMES[cls.toUpperCase().trim()] ?? null;
}

export function scoringClassRank(name: string): number {
  const i = SCORING_CLASSES.indexOf(name);
  return i === -1 ? 100 : i;
}
