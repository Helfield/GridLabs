/**
 * Car-class naming, shared by the database queries, the library pages
 * and the Discord leaderboard. Pure -- no database or view imports -- so
 * anything can use it.
 *
 * The keys are what carClass() (db/queries.ts) extracts from the app's
 * "<class> · <entry>" car names, upper-cased and then canonicalised by
 * canonicalClass() below, so one physical class has one board. The raw
 * values seen in real uploads are HYPER, LMP2, LMP2_ELMS, LMP3, GTE and
 * GT3; the others are here so a class the sim adds later still sorts and
 * reads sensibly.
 */

export const UNCLASSIFIED = "UNCLASSIFIED";

// As a timing screen would list them: fastest cars first.
const CLASS_ORDER = ["HYPER", "HYPERCAR", "LMH", "LMDH", "LMP2", "LMP2_ELMS", "LMP3", "GTE", "GT3", "GT4"];

const DISPLAY_NAMES: Record<string, string> = {
  HYPER: "Hypercar",
  HYPERCAR: "Hypercar",
  LMH: "Hypercar",
  LMDH: "Hypercar",
  LMP2_ELMS: "LMP2",
  [UNCLASSIFIED]: "Unclassified",
};

/**
 * The spellings that mean the same car. The sim files the ELMS-spec LMP2
 * under its own token, and Hypercar arrives as HYPER, LMH or LMDh depending
 * on the series, so a raw token splits cars that race together and gives a
 * track two columns labelled "Hypercar".
 */
const CANONICAL: Record<string, string> = {
  HYPER: "HYPERCAR",
  LMH: "HYPERCAR",
  LMDH: "HYPERCAR",
  LMP2_ELMS: "LMP2",
};

/**
 * The class everything should treat a car as belonging to: boards, the
 * library's grouping, which reference laps get promoted against each other,
 * and which reference lap the app measures a driver against. Applied inside
 * carClass(), so callers get it without asking. Stored rows keep the token
 * they were written with, which is why DISPLAY_NAMES still resolves the old
 * spellings.
 */
export function canonicalClass(cls: string | null | undefined): string | null {
  if (!cls) return null;
  return CANONICAL[cls] ?? cls;
}

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
 * uses this name; it agrees with canonicalClass() on purpose, so the standings
 * and the lap boards never disagree about whether two cars are rivals.
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
