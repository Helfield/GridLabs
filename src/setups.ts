/**
 * Checking a shared car setup before it is stored.
 *
 * The desktop app sends the setup that was loaded in the garage when a lap
 * was driven: the .svm file's text, and the garage's own list of setting
 * values (the "live" values the app can write back into the game). Both
 * come from a client we don't control, so everything is whitelisted here:
 * only setting keys the garage uses (VM_* and per-wheel WM_*), small
 * integers, short labels, and a size cap on the file. Anything that isn't
 * recognised is dropped rather than stored. Driver and team names never
 * belong in a setup and are not part of what is accepted.
 */

export type LiveValue = { value: number; stringValue: string; minValue: number | null; maxValue: number | null };
export type SetupInput = {
  name: string;
  carModel: string | null;
  trackFolder: string | null;
  svm: string | null;
  live: Record<string, LiveValue> | null;
};

const MAX_SVM_CHARS = 120_000;
const MAX_KEYS = 400;
const KEY_RE = /^(VM|WM)_[A-Za-z0-9_]+(-W_(FL|FR|RL|RR))?$/;

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u001f]/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) ? value : null;
}

export function sanitiseLive(raw: unknown): Record<string, LiveValue> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, LiveValue> = {};
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (!KEY_RE.test(key) || !entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const value = int(e.value);
    if (value === null) continue;
    out[key] = {
      value,
      stringValue: shortText(e.stringValue, 80) ?? "",
      minValue: int(e.minValue),
      maxValue: int(e.maxValue),
    };
  }
  return Object.keys(out).length ? out : null;
}

/** The cleaned setup, or null when there's nothing usable in it. */
export function sanitiseSetup(raw: unknown): SetupInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = shortText(r.name, 200);
  if (!name) return null;
  const svm =
    typeof r.svm === "string" && r.svm.length > 0 && r.svm.length <= MAX_SVM_CHARS && !r.svm.includes("\u0000")
      ? r.svm
      : null;
  const live = sanitiseLive(r.live);
  if (!svm && !live) return null;
  return { name, carModel: shortText(r.carModel, 200), trackFolder: shortText(r.trackFolder, 200), svm, live };
}
