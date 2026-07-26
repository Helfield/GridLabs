/**
 * components.ts
 *
 * Shared pieces used across pages: time formatting, the motorsport
 * timing-colour rules, and small hand-built SVG charts.
 *
 * Charts are generated as plain SVG rather than pulled from a charting
 * library -- it keeps the dependency list short, works without any
 * client-side JS, and matches the design exactly.
 */

import { escapeHtml } from "./layout";

/** 92.456 -> "1:32.456"  (motorsport convention, always mm:ss.mmm) */
export function lapTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

/** Sector times are short enough to read as plain seconds. */
export function sectorTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return "—";
  return seconds.toFixed(3);
}

/** Signed gap, e.g. "-0.412" / "+1.008" -- sign carries the meaning. */
export function delta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return "—";
  const sign = seconds > 0 ? "+" : seconds < 0 ? "\u2212" : "";
  return `${sign}${Math.abs(seconds).toFixed(3)}`;
}

export function shortDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export function fullDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Motorsport timing colours, applied to a value against a set of
 * comparable values. This is the one place the purple/green convention
 * is decided, so it stays consistent everywhere:
 *
 *   purple  the fastest of the set        (your best)
 *   green   better than the set's average (a good one)
 *   plain   everything else
 *
 * Returns a CSS class, not a colour, so the palette stays in one file.
 */
export function timingClass(value: number | null | undefined, all: Array<number | null | undefined>): string {
  if (value === null || value === undefined || !isFinite(value)) return "t-none";
  const valid = all.filter((v): v is number => v !== null && v !== undefined && isFinite(v));
  if (valid.length === 0) return "t-slow";
  const best = Math.min(...valid);
  if (value <= best) return "t-fastest";
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  return value < mean ? "t-pb" : "t-slow";
}

export function timingLegend(): string {
  return `
<div class="legend">
  <span><i style="background:var(--fastest)"></i>Fastest</span>
  <span><i style="background:var(--pb)"></i>Above average</span>
  <span><i style="background:var(--muted)"></i>Slower</span>
</div>`;
}

/**
 * Lap times over time. Y is inverted so that faster laps sit higher --
 * "up and to the right" should mean improvement, which is the opposite
 * of plotting raw seconds.
 */
export function lapTimeChart(
  points: Array<{ lapTimeSeconds: number; createdAt: Date | string }>,
  opts: { width?: number; height?: number } = {},
): string {
  const w = opts.width ?? 720;
  const h = opts.height ?? 210;
  const padL = 8, padR = 8, padT = 16, padB = 26;

  if (points.length < 2) {
    return `<div class="empty"><strong>Not enough laps yet</strong>Drive at least two timed laps on a track and the trend shows up here.</div>`;
  }

  const times = points.map((p) => p.lapTimeSeconds);
  const best = Math.min(...times);
  const worst = Math.max(...times);
  // Guard against a flat line (every lap identical) dividing by zero.
  const span = worst - best || 1;
  const padSpan = span * 0.18;
  const lo = best - padSpan;
  const hi = worst + padSpan;

  const x = (i: number) => padL + (i / (points.length - 1)) * (w - padL - padR);
  const y = (t: number) => padT + ((t - lo) / (hi - lo)) * (h - padT - padB);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.lapTimeSeconds).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)},${h - padB}L${x(0).toFixed(1)},${h - padB}Z`;

  const bestIdx = times.indexOf(best);
  const dots = points
    .map((p, i) => {
      const isBest = i === bestIdx;
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.lapTimeSeconds).toFixed(1)}" r="${isBest ? 4.5 : 2.6}"
        fill="${isBest ? "var(--fastest)" : "var(--panel)"}" stroke="${isBest ? "var(--fastest)" : "var(--muted)"}" stroke-width="1.5"/>`;
    })
    .join("");

  const bestY = y(best).toFixed(1);

  return `
<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Lap times over time, fastest lap ${lapTime(best)}">
  <defs>
    <linearGradient id="fadeArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--fastest)" stop-opacity=".22"/>
      <stop offset="100%" stop-color="var(--fastest)" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <line x1="${padL}" y1="${bestY}" x2="${w - padR}" y2="${bestY}" stroke="var(--fastest)" stroke-width="1" stroke-dasharray="3 4" opacity=".5"/>
  <text x="${w - padR}" y="${Number(bestY) - 7}" text-anchor="end" fill="var(--fastest)"
    font-family="IBM Plex Mono, monospace" font-size="10.5" letter-spacing=".08em">BEST ${escapeHtml(lapTime(best))}</text>
  <path d="${area}" fill="url(#fadeArea)"/>
  <path d="${line}" fill="none" stroke="var(--fastest)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
    stroke-dasharray="2600" stroke-dashoffset="0" style="animation:drawA 1.1s cubic-bezier(.3,.8,.4,1) both"/>
  ${dots}
  <text x="${padL}" y="${h - 7}" fill="var(--dim)" font-family="IBM Plex Mono, monospace" font-size="10.5" letter-spacing=".08em">${escapeHtml(shortDate(points[0].createdAt))}</text>
  <text x="${w - padR}" y="${h - 7}" text-anchor="end" fill="var(--dim)" font-family="IBM Plex Mono, monospace" font-size="10.5" letter-spacing=".08em">${escapeHtml(shortDate(points[points.length - 1].createdAt))}</text>
</svg>`;
}

/**
 * The delta trace: the signature graphic. A line that rides above and
 * below a zero baseline showing where a lap gains and loses against a
 * reference. This is the diagram version used on the landing page to
 * explain the idea -- the shape is fixed, not data from any real lap.
 */
export function deltaTraceDiagram(): string {
  const w = 620, h = 176;
  const mid = 88;
  // Hand-placed so the story reads left to right: lose a little into
  // the first corner, gain through the middle sector, lose it again
  // under braking at the end.
  const path =
    "M0,88 C40,86 62,74 92,70 C124,66 140,84 168,96 C196,108 214,112 244,104 " +
    "C274,96 288,72 320,62 C352,52 372,60 400,72 C428,84 442,104 472,116 " +
    "C502,128 536,120 566,108 C588,99 604,94 620,92";

  const sectors = [206, 412];

  return `
<figure class="trace">
<svg viewBox="0 0 ${w} ${h}" class="chart" role="img"
  aria-label="Diagram of a delta trace: the line rises where a lap loses time against the reference and falls where it gains">
  <defs>
    <linearGradient id="lossFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--warn)" stop-opacity="0"/>
      <stop offset="100%" stop-color="var(--warn)" stop-opacity=".16"/>
    </linearGradient>
    <clipPath id="belowMid"><rect x="0" y="${mid}" width="${w}" height="${h - mid}"/></clipPath>
    <clipPath id="aboveMid"><rect x="0" y="0" width="${w}" height="${mid}"/></clipPath>
  </defs>

  ${sectors
    .map(
      (sx) =>
        `<line x1="${sx}" y1="14" x2="${sx}" y2="${h - 30}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 5"/>`,
    )
    .join("")}
  ${["S1", "S2", "S3"]
    .map((label, i) => {
      const cx = i === 0 ? 103 : i === 1 ? 309 : 516;
      return `<text x="${cx}" y="${h - 12}" text-anchor="middle" fill="var(--dim)"
        font-family="IBM Plex Mono, monospace" font-size="10" letter-spacing=".14em">${label}</text>`;
    })
    .join("")}

  <line x1="0" y1="${mid}" x2="${w}" y2="${mid}" stroke="var(--line)" stroke-width="1"/>
  <text x="6" y="${mid - 9}" fill="var(--dim)" font-family="IBM Plex Mono, monospace" font-size="10" letter-spacing=".1em">LOSING</text>
  <text x="6" y="${mid + 19}" fill="var(--dim)" font-family="IBM Plex Mono, monospace" font-size="10" letter-spacing=".1em">GAINING</text>

  <g clip-path="url(#belowMid)">
    <path d="${path}L${w},${mid}L0,${mid}Z" fill="var(--pb)" opacity=".13"/>
  </g>
  <g clip-path="url(#aboveMid)">
    <path d="${path}L${w},${mid}L0,${mid}Z" fill="url(#lossFill)"/>
  </g>

  <path d="${path}" fill="none" stroke="var(--fastest)" stroke-width="2.4" stroke-linecap="round"
    stroke-dasharray="1400" stroke-dashoffset="0" style="animation:drawB 1.6s cubic-bezier(.32,.8,.36,1) .25s both"/>
  <circle cx="320" cy="62" r="4" fill="var(--pb)"/>
  <circle cx="472" cy="116" r="4" fill="var(--warn)"/>
</svg>
<figcaption class="chart-note">Delta to your reference lap — where the time actually goes</figcaption>
</figure>`;
}
