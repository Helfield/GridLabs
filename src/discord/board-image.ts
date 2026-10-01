import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

/**
 * The leaderboard as a picture.
 *
 * Discord caps a message at ~6000 characters of embeds, which a board
 * covering every track and car class outgrows quickly -- and a designed
 * board is what was asked for. So the site draws it: an SVG in the same
 * palette and fonts as the website, turned into a PNG by resvg (the
 * WebAssembly build, so there's no native binary to break on a server).
 * The fonts are bundled beside this file so the result is identical on
 * any machine, and nothing here touches the network.
 *
 * Layout: a wide table. One row per track (alphabetical), one column per
 * car class, each cell holding the fastest lap's time with the driver
 * under it. Classes are colour-coded and never ranked against one
 * another; a class nobody has set a time in at a track is left as a dash.
 * Wide rather than tall because Discord shows a chat image at roughly
 * 550x400 -- a tall list shrinks to nothing, a wide one stays readable.
 */

export type BoardRow = { classKey: string; classLabel: string; time: string; driver: string };
export type BoardTrack = { track: string; rows: BoardRow[] };

// ---------------------------------------------------------------- theme
// The website's palette (views/layout.ts :root).
const C = {
  carbon: "#0B0E14",
  panel: "#131822",
  panel2: "#1A2130",
  line: "#242C3A",
  lineSoft: "#1B2230",
  text: "#E8ECF4",
  muted: "#8492A6",
  dim: "#5D6A7D",
  fastest: "#B14BFF",
};

const CLASS_COLOURS: Record<string, string> = {
  HYPER: "#FF4D4D",
  HYPERCAR: "#FF4D4D",
  LMH: "#FF4D4D",
  LMDH: "#FF4D4D",
  LMP2: "#4C8DFF",
  LMP2_ELMS: "#4C8DFF",
  LMP3: "#22D0C9",
  GTE: "#22D07E",
  GT3: "#FFB020",
  GT4: "#F472B6",
};
const FALLBACK_CLASS_COLOUR = "#8492A6";

/** Left-to-right order of the class columns; anything else follows alphabetically. */
const CLASS_ORDER = ["HYPER", "HYPERCAR", "LMH", "LMDH", "LMP2", "LMP2_ELMS", "LMP3", "GTE", "GT3", "GT4"];

// ------------------------------------------------------------- geometry
const W = 2000;
const MARGIN = 56;
const HEADER_H = 178;
const FOOTER_H = 84;
const TRACK_COL_W = 400;
const HEAD_ROW_H = 74; // the class-chip header row
const ROW_H = 84;

// ---------------------------------------------------------------- fonts
const FONT_FILES = [
  "BarlowCondensed-SemiBold.ttf",
  "BarlowCondensed-Bold.ttf",
  "IBMPlexMono-Medium.ttf",
  "IBMPlexMono-SemiBold.ttf",
];

let ready: Promise<Uint8Array[]> | null = null;

/** Load the WASM module and the fonts, once. */
function prepare(): Promise<Uint8Array[]> {
  if (!ready) {
    ready = (async () => {
      const require = createRequire(import.meta.url);
      await initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
      return FONT_FILES.map((name) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./fonts/${name}`, import.meta.url)))));
    })().catch((err) => {
      ready = null; // let the next call try again
      throw err;
    });
  }
  return ready;
}

// ----------------------------------------------------------------- text
/**
 * Keep only characters the bundled fonts can draw. A driver called
 * something outside Latin would otherwise render as empty boxes -- there
 * are no system fonts to fall back to on a server.
 */
function clean(text: string): string {
  return text
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[^ -ɏ–—’·…]/g, "?")
    .trim();
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ellipsise(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

/** Font size that fits `text` in `width`, given an average glyph width (in ems). */
function fit(text: string, width: number, maxSize: number, minSize: number, em: number): number {
  const size = width / Math.max(1, text.length * em);
  return Math.max(minSize, Math.min(maxSize, size));
}

// ---------------------------------------------------------------- render
export async function renderBoardPng(tracks: BoardTrack[], updatedAt: Date): Promise<Uint8Array> {
  const fontBuffers = await prepare();
  const svg = buildSvg(tracks, updatedAt);
  const resvg = new Resvg(svg, {
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: "Barlow Condensed" },
    fitTo: { mode: "width", value: W },
  });
  return resvg.render().asPng();
}

export function buildSvg(tracks: BoardTrack[], updatedAt: Date): string {
  // Only the classes somebody has actually set a time in.
  const labels = new Map<string, string>();
  for (const t of tracks) for (const r of t.rows) if (!labels.has(r.classKey)) labels.set(r.classKey, r.classLabel);
  const classes = [...labels.keys()].sort((a, b) => {
    const ia = CLASS_ORDER.indexOf(a);
    const ib = CLASS_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  const tableW = W - MARGIN * 2;
  const colW = classes.length ? (tableW - TRACK_COL_W) / classes.length : 0;
  const bodyH = tracks.length ? HEAD_ROW_H + tracks.length * ROW_H : 200;
  const H = HEADER_H + bodyH + FOOTER_H;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<defs>
  <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
    <path d="M44 0H0V44" fill="none" stroke="${C.lineSoft}" stroke-width="1"/>
  </pattern>
  <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${C.fastest}" stop-opacity="0.22"/>
    <stop offset="1" stop-color="${C.fastest}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#C77DFF"/>
    <stop offset="1" stop-color="${C.fastest}"/>
  </linearGradient>
</defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="${C.carbon}"/>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#grid)" opacity="0.7"/>`);
  parts.push(`<rect width="${W}" height="${HEADER_H}" fill="url(#glow)"/>`);

  // ---- header
  const bx = MARGIN;
  parts.push(`<rect x="${bx}" y="46" width="7" height="14" rx="1.5" fill="url(#bar)"/>
<rect x="${bx + 11}" y="38" width="7" height="22" rx="1.5" fill="url(#bar)"/>
<rect x="${bx + 22}" y="28" width="7" height="32" rx="1.5" fill="url(#bar)"/>`);
  parts.push(`<text x="${bx + 44}" y="60" font-family="Barlow Condensed" font-weight="700" font-size="36" letter-spacing="3.5" fill="${C.text}">GRIDLABS</text>`);
  parts.push(`<text x="${W - MARGIN}" y="58" text-anchor="end" font-family="IBM Plex Mono" font-weight="500" font-size="17" letter-spacing="2.5" fill="${C.dim}">LE MANS ULTIMATE</text>`);
  parts.push(`<text x="${MARGIN}" y="146" font-family="Barlow Condensed" font-weight="700" font-size="88" letter-spacing="1.5" fill="${C.text}">FASTEST <tspan fill="${C.fastest}">LAPS</tspan></text>`);
  parts.push(`<text x="${W - MARGIN}" y="130" text-anchor="end" font-family="IBM Plex Mono" font-weight="500" font-size="18" letter-spacing="0.6" fill="${C.muted}">
    <tspan x="${W - MARGIN}" dy="0">Best valid lap per track</tspan><tspan x="${W - MARGIN}" dy="28">Each car class ranked on its own</tspan>
  </text>`);
  parts.push(`<line x1="${MARGIN}" y1="${HEADER_H - 6}" x2="${W - MARGIN}" y2="${HEADER_H - 6}" stroke="${C.line}" stroke-width="1.5"/>`);

  if (tracks.length === 0) {
    parts.push(`<text x="${W / 2}" y="${HEADER_H + 100}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="34" letter-spacing="2" fill="${C.muted}">NO VALID LAPS YET</text>`);
  } else {
    parts.push(table(tracks, classes, labels, colW));
  }

  // ---- footer
  const stamp = updatedAt.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "UTC",
  });
  parts.push(`<text x="${W / 2}" y="${H - 34}" text-anchor="middle" font-family="IBM Plex Mono" font-weight="500" font-size="16" letter-spacing="0.8" fill="${C.dim}">Track cuts and disqualified laps excluded  ·  updated ${esc(stamp)} UTC</text>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

/** Split a long track name over two lines at the space nearest its middle. */
function wrapTitle(title: string): string[] {
  if (title.length <= 21) return [title];
  const mid = title.length / 2;
  let best = -1;
  for (let i = 0; i < title.length; i++) {
    if (title[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return best < 0 ? [title] : [title.slice(0, best), title.slice(best + 1)];
}

function table(tracks: BoardTrack[], classes: string[], labels: Map<string, string>, colW: number): string {
  const out: string[] = [];
  const x0 = MARGIN;
  const tableW = W - MARGIN * 2;
  const top = HEADER_H + 10;

  // ---- class header chips
  classes.forEach((cls, ci) => {
    const colour = CLASS_COLOURS[cls] ?? FALLBACK_CLASS_COLOUR;
    const label = clean(labels.get(cls) ?? cls).toUpperCase();
    const cx = x0 + TRACK_COL_W + ci * colW + colW / 2;
    const chipW = Math.min(colW - 28, 230);
    out.push(`<rect x="${cx - chipW / 2}" y="${top + 12}" width="${chipW}" height="46" rx="12" fill="${colour}" fill-opacity="0.16" stroke="${colour}" stroke-opacity="0.8" stroke-width="2"/>`);
    out.push(`<text x="${cx}" y="${top + 45}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="${fit(label, chipW - 24, 30, 18, 0.56).toFixed(1)}" letter-spacing="1.5" fill="${colour}">${esc(label)}</text>`);
  });
  out.push(`<text x="${x0 + 24}" y="${top + 45}" font-family="IBM Plex Mono" font-weight="500" font-size="16" letter-spacing="2.5" fill="${C.dim}">TRACK</text>`);

  // ---- rows
  const bodyTop = top + HEAD_ROW_H;
  out.push(`<rect x="${x0}" y="${bodyTop}" width="${tableW}" height="${tracks.length * ROW_H}" rx="14" fill="${C.panel}" stroke="${C.line}" stroke-width="1.5"/>`);
  tracks.forEach((t, ri) => {
    const ry = bodyTop + ri * ROW_H;
    if (ri % 2 === 1) {
      out.push(`<rect x="${x0 + 1}" y="${ry}" width="${tableW - 2}" height="${ROW_H}" fill="${C.panel2}" fill-opacity="0.55"/>`);
    }
    if (ri > 0) out.push(`<line x1="${x0 + 1}" y1="${ry}" x2="${x0 + tableW - 1}" y2="${ry}" stroke="${C.lineSoft}" stroke-width="1"/>`);

    // track name, over two lines when it is long
    const lines = wrapTitle(clean(t.track).toUpperCase());
    // One size for every name so the column reads evenly; only a name too
    // long for the column at that size is shrunk.
    const size = Math.min(...lines.map((l) => fit(l, TRACK_COL_W - 48, 30, 20, 0.5)));
    lines.forEach((line, li) => {
      const baseline = lines.length === 1
        ? ry + ROW_H / 2 + size * 0.34
        : ry + ROW_H / 2 - 6 + li * (size + 2) + size * 0.3;
      out.push(`<text x="${x0 + 24}" y="${baseline.toFixed(1)}" font-family="Barlow Condensed" font-weight="700" font-size="${size.toFixed(1)}" letter-spacing="0.8" fill="${C.text}">${esc(line)}</text>`);
    });

    // one cell per class
    classes.forEach((cls, ci) => {
      const cx = x0 + TRACK_COL_W + ci * colW + colW / 2;
      const row = t.rows.find((r) => r.classKey === cls);
      if (!row) {
        out.push(`<text x="${cx}" y="${ry + ROW_H / 2 + 8}" text-anchor="middle" font-family="IBM Plex Mono" font-weight="500" font-size="26" fill="${C.line}">—</text>`);
        return;
      }
      const driver = ellipsise(clean(row.driver), 22);
      const driverSize = fit(driver, colW - 36, 24, 16, 0.44);
      out.push(`<text x="${cx}" y="${ry + 42}" text-anchor="middle" font-family="IBM Plex Mono" font-weight="600" font-size="33" fill="${C.text}">${esc(row.time)}</text>`);
      out.push(`<text x="${cx}" y="${ry + 69}" text-anchor="middle" font-family="Barlow Condensed" font-weight="600" font-size="${driverSize.toFixed(1)}" fill="${C.muted}">${esc(driver)}</text>`);
    });
  });
  return out.join("\n");
}
