import { layout, escapeHtml, type NavUser } from "./layout";
import { lapTime } from "./components";
import { classDisplayName } from "../classes";
import { quarterTurns, rotatePoint } from "../mapOrientation";

type Nav = NonNullable<NavUser>;

export type TrackSummary = {
  track: string;
  lapCount: number;
  bestLapTimeSeconds: number | null;
  // Fastest published lap in each car class on this track, in class
  // order -- classes are never ranked against each other.
  classBests: Array<{ carClass: string; bestLapTimeSeconds: number | null }>;
  sampleData: unknown | null; // one lap's data, used to draw the layout
};

export type ClassGroup = { carClass: string; laps: LibraryLap[] };

const className = classDisplayName;

export type LibraryLap = {
  id: number;
  track: string;
  car: string;
  carDisplay: string | null;
  label: string;
  lapTimeSeconds: number | null;
  createdAt: Date;
};

/**
 * Draw a track's layout straight from a reference lap's telemetry.
 *
 * Every reference lap already stores world_x/world_z per distance bin --
 * that IS the racing line, so the layout comes free with the data. No
 * image files to source, licence, or keep in sync with the sim, and a
 * track can never show the wrong picture: the drawing is the lap.
 *
 * Braking is coloured red on the line, matching the in-app track map's
 * single threshold -- this used to have a separate amber tier for light
 * braking, dropped because the live pedal traces already show that
 * nuance elsewhere; this map only needs to answer "where do you brake".
 */
const BRAKE_ON = 0.15;

function layoutSvg(data: any, track: string, width: number, height: number, showBraking: boolean): string {
  const samples = data?.samples;
  if (!samples || typeof samples !== "object") return placeholderSvg(width, height);

  const points = Object.keys(samples)
    .map((k) => [Number(k), samples[k]] as const)
    .filter(([n]) => Number.isFinite(n))
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => s)
    .filter((s: any) => typeof s?.world_x === "number" && typeof s?.world_z === "number");

  if (points.length < 3) return placeholderSvg(width, height);

  // Same way up as the in-game map (see mapOrientation.ts).
  const turns = quarterTurns(track);
  const turned = points.map((p: any) => {
    const [x, z] = rotatePoint(p.world_x, p.world_z, turns);
    return { ...p, world_x: x, world_z: z };
  });
  points.length = 0;
  points.push(...turned);

  const xs = points.map((p: any) => p.world_x);
  const zs = points.map((p: any) => p.world_z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const spanX = maxX - minX || 1;
  const spanZ = maxZ - minZ || 1;

  const pad = 14;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanZ);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanZ * scale) / 2;

  const project = (p: any) => [
    offX + (p.world_x - minX) * scale,
    // z grows "up" in world space; flip it so the shape isn't mirrored
    height - (offY + (p.world_z - minZ) * scale),
  ];

  if (!showBraking) {
    const d = points.map(project).map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    return `<svg class="layout" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <path d="${d}Z" fill="none" stroke="var(--fastest)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/>
</svg>`;
  }

  // Per-segment colouring needs one path per segment.
  const segs: string[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = project(points[i]);
    const [x2, y2] = project(points[i + 1]);
    const brake = Math.max(points[i].brake ?? 0, points[i + 1].brake ?? 0);
    const colour = brake > BRAKE_ON ? "#ff3b3b" : "var(--fastest)";
    segs.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${colour}" stroke-width="4" stroke-linecap="round"/>`);
  }
  return `<svg class="layout" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${segs.join("")}</svg>`;
}

function placeholderSvg(width: number, height: number): string {
  return `<svg class="layout layout--empty" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle"
        fill="var(--dim)" font-family="monospace" font-size="11" letter-spacing="1.5">NO LAYOUT YET</text>
</svg>`;
}

export function trackLibraryPage(navUser: Nav, tracks: TrackSummary[]): string {
  const cards =
    tracks.length === 0
      ? `<div class="empty"><strong>Nothing in the library yet</strong>Upload a reference lap and its track appears here.</div>`
      : `<div class="tgrid">
${tracks
  .map(
    (t) => `
  <a class="tcard" href="/library/track/${encodeURIComponent(t.track)}">
    <div class="tcard__map">${layoutSvg(t.sampleData, t.track, 300, 180, false)}</div>
    <div class="tcard__body">
      <div class="tcard__name">${escapeHtml(t.track)}</div>
      <div class="tcard__classes">
        ${t.classBests.length === 0
          ? `<div class="tcard__class"><span>No timed laps</span></div>`
          : t.classBests
              .map(
                (b) => `<div class="tcard__class"><span class="tag">${escapeHtml(className(b.carClass))}</span><span class="mono t-fastest">${escapeHtml(lapTime(b.bestLapTimeSeconds))}</span></div>`,
              )
              .join("")}
      </div>
      <div class="tcard__meta"><span>${t.lapCount} lap${t.lapCount === 1 ? "" : "s"} published</span></div>
    </div>
  </a>`,
  )
  .join("")}
</div>`;

  const body = `
<div class="phead">
  <div>
    <span class="eyebrow">Library</span>
    <h1>Reference laps</h1>
    <p class="phead__sub">Pick a track, download a lap, then use <strong>Import lap</strong> in the app to drive against it.</p>
  </div>
  ${navUser.role === "coach" ? `<a class="btn btn--ghost btn--sm" href="/coach/reference-laps">Upload a lap</a>` : ""}
</div>
${cards}
${LIBRARY_CSS}`;
  return layout("Reference laps", body, navUser);
}

export function trackDetailPage(navUser: Nav, track: string, classes: ClassGroup[], sampleData: unknown | null): string {
  const lapCount = classes.reduce((n, c) => n + c.laps.length, 0);

  const classPanels =
    classes.length === 0
      ? `<section class="panel"><div class="empty"><strong>No laps here yet</strong>Nothing has been published for this track.</div></section>`
      : classes
          .map(
            (c) => `
  <section class="panel">
    <div class="panel__head">
      <h2>${escapeHtml(className(c.carClass))}</h2>
      <span class="tag">${c.laps.length} lap${c.laps.length === 1 ? "" : "s"}</span>
    </div>
    <table class="tower">
      <thead>
        <tr><th>Lap</th><th>Car</th><th class="col-r">Time</th><th class="col-r"></th></tr>
      </thead>
      <tbody>
${c.laps
  .map(
    (l, i) => `
        <tr>
          <td><div class="driver__name">${escapeHtml(l.label)}${i === 0 ? ` <span class="tag tag--fastest">Fastest</span>` : ""}</div></td>
          <td style="color:var(--muted)">${escapeHtml(l.carDisplay || l.car)}</td>
          <td class="num col-r laptime ${i === 0 ? "t-fastest" : ""}">${escapeHtml(lapTime(l.lapTimeSeconds))}${i === 0 ? "" : `<div class="hint" style="margin:2px 0 0">+${((l.lapTimeSeconds ?? 0) - (c.laps[0].lapTimeSeconds ?? 0)).toFixed(3)}</div>`}</td>
          <td class="col-r"><a class="btn btn--ghost btn--sm" href="/library/lap/${l.id}/download">Download</a></td>
        </tr>`,
  )
  .join("")}
      </tbody>
    </table>
  </section>`,
          )
          .join("");

  const body = `
<a class="backlink" href="/library">&larr; All tracks</a>
<div class="phead">
  <div>
    <span class="eyebrow">Track</span>
    <h1>${escapeHtml(track)}</h1>
    <p class="phead__sub">${lapCount} reference lap${lapCount === 1 ? "" : "s"} across ${classes.length} car class${classes.length === 1 ? "" : "es"} — each class is ranked on its own, fastest first</p>
  </div>
</div>
<div class="grid-2">
  <div class="stack">
    ${classPanels}
    <p class="hint">Download a lap, then in the app click <strong>Import lap</strong> (top right) and choose the file. It'll appear in the <strong>Driving against</strong> dropdown for this track.</p>
  </div>
  <section class="panel">
    <div class="panel__head"><h2>Layout</h2><span class="tag">From lap data</span></div>
    <div class="panel__body">
      ${layoutSvg(sampleData, track, 420, 320, true)}
      <div class="legend" style="margin-top:14px">
        <span><i style="background:#ff3b3b"></i>Braking</span>
        <span><i style="background:var(--fastest)"></i>Off the brakes</span>
      </div>
    </div>
  </section>
</div>
${LIBRARY_CSS}`;
  return layout(track, body, navUser);
}

const LIBRARY_CSS = `
<style>
.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(258px,1fr));gap:18px}
.tcard{
  display:block;text-decoration:none;background:var(--panel);border:1px solid var(--line);
  border-radius:var(--r);overflow:hidden;transition:border-color .15s,transform .12s;
}
.tcard:hover{border-color:var(--fastest);transform:translateY(-2px)}
.tcard__map{background:var(--carbon);border-bottom:1px solid var(--line-soft);padding:6px}
.tcard__body{padding:13px 15px 15px}
.tcard__name{
  font-family:'Barlow Condensed',sans-serif;font-size:19px;font-weight:600;
  text-transform:uppercase;letter-spacing:.03em;line-height:1.15;
}
.tcard__meta{
  display:flex;justify-content:space-between;gap:10px;margin-top:7px;
  font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--dim);
}
.tcard__classes{margin-top:9px;display:grid;gap:5px}
.tcard__class{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px}
.tcard__class .mono{font-family:'IBM Plex Mono',monospace;font-size:13px}
.stack{display:grid;gap:18px;align-content:start}
.tag--fastest{color:var(--fastest);border-color:var(--fastest)}
.layout{width:100%;height:auto;display:block}
.layout--empty{opacity:.5}
</style>`;