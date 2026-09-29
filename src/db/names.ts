/**
 * Display-name rules.
 *
 * A driver's name appears on their lap pages, the coach's roster, and as
 * a picture on the Discord leaderboard -- where it is drawn with bundled
 * Latin fonts and nothing to fall back to. So the rules keep it short
 * enough to fit a leaderboard row and limited to characters those fonts
 * can actually draw: letters (including accented ones), digits, spaces,
 * and . ' _ -
 */

export const NAME_MIN = 2;
export const NAME_MAX = 24;

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

export function validateDisplayName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, message: "Enter a name." };

  // Tidy first: surrounding space and runs of spaces are never intended.
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();

  if (name.length < NAME_MIN) {
    return { ok: false, message: `Names need at least ${NAME_MIN} characters.` };
  }
  if (name.length > NAME_MAX) {
    return { ok: false, message: `Keep it to ${NAME_MAX} characters or fewer so it fits on the leaderboard.` };
  }
  // Basic Latin plus Latin-1/Extended letters (U+00C0-U+024F), minus the
  // multiplication and division signs that sit inside that range.
  if (!/^[A-Za-z0-9À-ÖØ-öø-ɏ .'_-]+$/.test(name)) {
    return {
      ok: false,
      message: "Use letters, numbers, spaces and . ' _ - only (no emoji or symbols).",
    };
  }
  if (!/[A-Za-z0-9À-ɏ]/.test(name)) {
    return { ok: false, message: "Include at least one letter or number." };
  }
  return { ok: true, name };
}
