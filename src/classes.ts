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
