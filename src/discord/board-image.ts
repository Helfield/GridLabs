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
 * Layout: a header, then one card per track in two columns (filled down
 * the left column and then the right, so the tracks still read
 * alphabetically), each card listing the fastest lap in every car class
 * as [class chip] [time] [driver]. Classes are colour-coded and never
 * ranked against one another.
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

// ------------------------------------------------------------- geometry
const W = 1200;
const MARGIN = 44;
const GAP = 24;
const COL_W = (W - MARGIN * 2 - GAP) / 2;
const HEADER_H = 190;
const FOOTER_H = 84;
const CARD_PAD = 24;
const CARD_TITLE_H = 66;
const ROW_H = 60;
const CARD_BOTTOM = 14;
const CHIP_W = 138;

function cardHeight(rows: number): number {
  return CARD_TITLE_H + Math.max(1, rows) * ROW_H + CARD_BOTTOM;
}

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
  // Newspaper columns: fill the left column to about half the total
  // height, then the right -- so alphabetical order reads down, not across.
  const heights = tracks.map((t) => cardHeight(t.rows.length) + GAP);
  const total = heights.reduce((a, b) => a + b, 0);
  const left: number[] = [];
  const right: number[] = [];
  let used = 0;
  tracks.forEach((_t, i) => {
    // Put a card left while doing so keeps the left column no more than
    // half a card past the midpoint.
    if (used + heights[i] / 2 <= total / 2 || left.length === 0) {
      left.push(i);
      used += heights[i];
    } else {
      right.push(i);
    }
  });

  const columnHeight = (idx: number[]) => idx.reduce((a, i) => a + heights[i], 0);
  const bodyH = tracks.length ? Math.max(columnHeight(left), columnHeight(right)) - GAP : 200;
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
  parts.push(`<text x="${MARGIN}" y="140" font-family="Barlow Condensed" font-weight="700" font-size="84" letter-spacing="1.5" fill="${C.text}">FASTEST <tspan fill="${C.fastest}">LAPS</tspan></text>`);
  parts.push(`<text x="${W - MARGIN}" y="138" text-anchor="end" font-family="IBM Plex Mono" font-weight="500" font-size="17" letter-spacing="0.6" fill="${C.muted}">
    <tspan x="${W - MARGIN}" dy="0">Best valid lap per track</tspan><tspan x="${W - MARGIN}" dy="26">Each car class ranked on its own</tspan>
  </text>`);
  parts.push(`<line x1="${MARGIN}" y1="${HEADER_H - 8}" x2="${W - MARGIN}" y2="${HEADER_H - 8}" stroke="${C.line}" stroke-width="1.5"/>`);

  // ---- cards
  const drawColumn = (indices: number[], x: number) => {
    let y = HEADER_H + 14;
    for (const i of indices) {
      parts.push(card(tracks[i], x, y));
      y += heights[i];
    }
  };
  if (tracks.length === 0) {
    parts.push(`<text x="${W / 2}" y="${HEADER_H + 100}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="34" letter-spacing="2" fill="${C.muted}">NO VALID LAPS YET</text>`);
  } else {
    drawColumn(left, MARGIN);
    drawColumn(right, MARGIN + COL_W + GAP);
  }

  // ---- footer
  const stamp = updatedAt.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "UTC",
  });
  parts.push(`<text x="${W / 2}" y="${H - 34}" text-anchor="middle" font-family="IBM Plex Mono" font-weight="500" font-size="15" letter-spacing="0.8" fill="${C.dim}">Track cuts and disqualified laps excluded  ·  updated ${esc(stamp)} UTC</text>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

function card(t: BoardTrack, x: number, y: number): string {
  const h = cardHeight(t.rows.length);
  const out: string[] = [];
  out.push(`<rect x="${x}" y="${y}" width="${COL_W}" height="${h}" rx="16" fill="${C.panel}" stroke="${C.line}" stroke-width="1.5"/>`);
  out.push(`<rect x="${x}" y="${y + 18}" width="5" height="${h - 36}" rx="2.5" fill="url(#bar)"/>`);

  const title = clean(t.track).toUpperCase();
  const titleW = COL_W - CARD_PAD * 2 - 6;
  const titleSize = fit(title, titleW, 34, 22, 0.5);
  out.push(`<text x="${x + CARD_PAD + 6}" y="${y + 43}" font-family="Barlow Condensed" font-weight="700" font-size="${titleSize.toFixed(1)}" letter-spacing="1" fill="${C.text}">${esc(title)}</text>`);
  out.push(`<line x1="${x + CARD_PAD + 6}" y1="${y + CARD_TITLE_H - 6}" x2="${x + COL_W - CARD_PAD}" y2="${y + CARD_TITLE_H - 6}" stroke="${C.line}" stroke-width="1"/>`);

  t.rows.forEach((r, i) => {
    const ry = y + CARD_TITLE_H + i * ROW_H;
    const colour = CLASS_COLOURS[r.classKey] ?? FALLBACK_CLASS_COLOUR;
    const cx = x + CARD_PAD + 6;
    const label = clean(r.classLabel).toUpperCase();

    if (i > 0) {
      out.push(`<line x1="${cx}" y1="${ry}" x2="${x + COL_W - CARD_PAD}" y2="${ry}" stroke="${C.lineSoft}" stroke-width="1"/>`);
    }
    out.push(`<rect x="${cx}" y="${ry + 12}" width="${CHIP_W}" height="36" rx="9" fill="${colour}" fill-opacity="0.14" stroke="${colour}" stroke-opacity="0.7" stroke-width="1.5"/>`);
    out.push(`<text x="${cx + CHIP_W / 2}" y="${ry + 37}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="${fit(label, CHIP_W - 16, 23, 15, 0.56).toFixed(1)}" letter-spacing="1.2" fill="${colour}">${esc(label)}</text>`);

    const timeX = cx + CHIP_W + 20;
    out.push(`<text x="${timeX}" y="${ry + 40}" font-family="IBM Plex Mono" font-weight="600" font-size="32" fill="${C.text}">${esc(r.time)}</text>`);

    // The driver gets whatever is left after the time (a mono glyph at 32px
    // is ~19.5px wide; times run to 8 characters) and shrinks to fit, so a
    // long name can never run into the number beside it.
    const driverRight = x + COL_W - CARD_PAD;
    const driverWidth = driverRight - (timeX + 8 * 19.5 + 16);
    const driver = ellipsise(clean(r.driver), 22);
    const driverSize = fit(driver, driverWidth, 27, 17, 0.44);
    out.push(`<text x="${driverRight}" y="${ry + 39}" text-anchor="end" font-family="Barlow Condensed" font-weight="600" font-size="${driverSize.toFixed(1)}" fill="${C.muted}">${esc(driver)}</text>`);
  });
  return out.join("\n");
}
