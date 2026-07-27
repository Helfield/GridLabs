import { layout, escapeHtml, type NavUser } from "./layout";
import { lapTime, sectorTime, shortDate, timingClass, timingLegend, lapTimeChart } from "./components";
import type { TrackProgress } from "../db/queries";

type SessionRow = {
  id: number;
  track: string;
  car: string;
  lapTimeSeconds: number | null;
  sector1Seconds: number | null;
  sector2Seconds: number | null;
  sector3Seconds: number | null;
  createdAt: Date;
};

type RefLapRow = {
  id: number;
  label: string;
  track: string;
  car: string;
  lapTimeSeconds: number | null;
};

type Nav = NonNullable<NavUser>;

export function studentDashboardPage(
  navUser: Nav,
  studentSessions: SessionRow[],
  referenceLapsOwned: RefLapRow[],
  publicLaps: RefLapRow[],
  progress: TrackProgress[] = [],
): string {
  const body = `
<div class="phead">
  <div>
    <span class="eyebrow">Driver</span>
    <h1>${escapeHtml(navUser.name)}</h1>
    <p class="phead__sub">Every timed lap the app has sent up, newest first.</p>
  </div>
</div>

${statStrip(studentSessions, referenceLapsOwned.length, progress)}

<div class="grid-2 mt">
  <div class="stack">
    ${trackProgressPanel(progress)}
    ${sessionTowerPanel(studentSessions, "/session")}
  </div>
  <div class="stack">
    ${refLapPanel("Your reference laps", referenceLapsOwned, "Set a personal best with the app running and it lands here automatically.")}
    ${refLapPanel("Shared with you", publicLaps, "When a coach marks one of their laps public, you can drive against it.")}
  </div>
</div>`;

  return layout("My driving", body, navUser);
}

/* ---------- shared panels, also used by the coach's driver view ---------- */

/**
 * `progress` is optional so the coach's driver view can keep calling
 * this with two arguments. Given it, the middle tile shows the closest
 * this driver has got to a published reference; without it, a plain
 * count of tracks.
 *
 * What it deliberately no longer shows is an overall "fastest lap".
 * Across different circuits that number is meaningless -- a short track
 * always wins it, which says nothing about how well anyone drove.
 */
export function statStrip(rows: SessionRow[], refLapCount: number, progress: TrackProgress[] = []): string {
  const tracks = new Set(rows.map((r) => r.track));

  const gaps = progress
    .map((p) => p.gapSeconds)
    .filter((g): g is number => g !== null);
  const bestGap = gaps.length ? Math.min(...gaps) : null;
  const bestGapRow = bestGap !== null ? progress.find((p) => p.gapSeconds === bestGap) : null;

  const middle =
    bestGap !== null
      ? `
  <div class="stat">
    <div class="stat__k">Closest to reference</div>
    <div class="stat__v ${bestGap <= 0 ? "t-pb" : "t-fastest"}">${escapeHtml(gapText(bestGap))}</div>
    <div class="stat__sub">${bestGapRow ? escapeHtml(bestGapRow.track) : ""}</div>
  </div>`
      : `
  <div class="stat">
    <div class="stat__k">Tracks driven</div>
    <div class="stat__v">${tracks.size}</div>
    <div class="stat__sub">${progress.length ? "No reference to compare against yet" : "Drive a lap to get started"}</div>
  </div>`;

  return `
<div class="stats">
  <div class="stat">
    <div class="stat__k">Laps logged</div>
    <div class="stat__v">${rows.length}</div>
    <div class="stat__sub">${tracks.size} ${tracks.size === 1 ? "track" : "tracks"}</div>
  </div>
  ${middle}
  <div class="stat">
    <div class="stat__k">Reference laps</div>
    <div class="stat__v">${refLapCount}</div>
    <div class="stat__sub">Saved for comparison</div>
  </div>
</div>`;
}

function gapText(gap: number): string {
  const sign = gap > 0 ? "+" : gap < 0 ? "-" : "";
  return `${sign}${Math.abs(gap).toFixed(3)}`;
}

/**
 * One row per track and class, sorted by the gap to the published
 * reference -- biggest first, so the combination with most time to find
 * is the one at the top of the list.
 *
 * This replaced a lap-time-over-sessions chart. With a handful of laps
 * driven on the same afternoon that chart was mostly noise, and it
 * couldn't answer the question a driver actually has, which is "where
 * am I losing the most, and to what?"
 */
export function trackProgressPanel(progress: TrackProgress[]): string {
  if (progress.length === 0) {
    return `
<section class="panel">
  <div class="panel__head"><h2>Your tracks</h2></div>
  <div class="empty"><strong>No laps yet</strong>Drive with the app running and each track you visit appears here.</div>
</section>`;
  }

  const rows = progress
    .map(
      (p) => `
    <tr>
      <td>
        <div class="driver__name">${escapeHtml(p.track)}</div>
        <div class="driver__handle">${escapeHtml(p.carClass ?? p.car)}</div>
      </td>
      <td class="num col-r">${p.lapCount}</td>
      <td class="num col-r laptime">${escapeHtml(lapTime(p.bestLapTimeSeconds))}</td>
      <td class="num col-r hide-sm" style="color:var(--muted)">${escapeHtml(lapTime(p.referenceLapTimeSeconds))}</td>
      <td class="num col-r laptime ${p.gapSeconds === null ? "t-none" : p.gapSeconds <= 0 ? "t-pb" : "t-slow"}">${
        p.gapSeconds === null ? "&mdash;" : escapeHtml(gapText(p.gapSeconds))
      }</td>
    </tr>`,
    )
    .join("");

  return `
<section class="panel">
  <div class="panel__head">
    <h2>Your tracks</h2>
    <span class="tag">Biggest gap first</span>
  </div>
  <table class="tower">
    <thead>
      <tr>
        <th>Track</th>
        <th class="col-r">Laps</th>
        <th class="col-r">Your best</th>
        <th class="col-r hide-sm">Reference</th>
        <th class="col-r">Gap</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="panel__body" style="border-top:1px solid var(--line-soft)">
    <p class="hint">Gap is your best lap against the quickest reference published for that track in the same class. A dash means nothing has been published to compare against yet.</p>
  </div>
</section>`;
}

export function progressPanel(rows: SessionRow[]): string {
  // Chart the track with the most laps -- mixing tracks on one axis
  // would compare times that have nothing to do with each other.
  const byTrack = new Map<string, SessionRow[]>();
  for (const r of rows) {
    if (r.lapTimeSeconds === null) continue;
    const list = byTrack.get(r.track) ?? [];
    list.push(r);
    byTrack.set(r.track, list);
  }

  let track: string | null = null;
  let laps: SessionRow[] = [];
  for (const [name, list] of byTrack) {
    if (list.length > laps.length) {
      track = name;
      laps = list;
    }
  }

  // Oldest first so the chart reads left to right in time.
  const points = [...laps]
    .reverse()
    .map((r) => ({ lapTimeSeconds: r.lapTimeSeconds as number, createdAt: r.createdAt }));

  return `
<section class="panel">
  <div class="panel__head">
    <h2>Progress</h2>
    <span class="tag">${track ? escapeHtml(track) : "No data"}</span>
  </div>
  <div class="panel__body">
    ${lapTimeChart(points)}
    ${points.length >= 2 ? `<p class="chart-note">Faster laps sit higher &middot; ${points.length} laps at this track</p>` : ""}
  </div>
</section>`;
}

export function sessionTowerPanel(rows: SessionRow[], linkBase: string | null): string {
  const allLaps = rows.map((r) => r.lapTimeSeconds);
  const s1 = rows.map((r) => r.sector1Seconds);
  const s2 = rows.map((r) => r.sector2Seconds);
  const s3 = rows.map((r) => r.sector3Seconds);
  const hasSectors = [...s1, ...s2, ...s3].some((v) => v !== null && v !== undefined);

  const body =
    rows.length === 0
      ? `<div class="empty"><strong>No laps yet</strong>Start the desktop app with your token, get on track, and finished laps show up here.</div>`
      : `
<table class="tower">
  <thead>
    <tr>
      <th class="pos">#</th>
      <th>Track</th>
      <th class="hide-sm">Car</th>
      ${hasSectors ? `<th class="col-r">S1</th><th class="col-r">S2</th><th class="col-r">S3</th>` : ""}
      <th class="col-r">Lap</th>
      <th class="col-r hide-sm">Date</th>
      ${linkBase ? `<th class="chev"></th>` : ""}
    </tr>
  </thead>
  <tbody>
    ${rows
      .map((r, i) => {
        const click = linkBase ? ` class="is-link" onclick="window.location='${linkBase}/${r.id}'"` : "";
        return `
    <tr${click}>
      <td class="num pos">${rows.length - i}</td>
      <td>${escapeHtml(r.track)}</td>
      <td class="hide-sm" style="color:var(--muted)">${escapeHtml(r.car)}</td>
      ${
        hasSectors
          ? `<td class="num col-r ${timingClass(r.sector1Seconds, s1)}">${escapeHtml(sectorTime(r.sector1Seconds))}</td>
             <td class="num col-r ${timingClass(r.sector2Seconds, s2)}">${escapeHtml(sectorTime(r.sector2Seconds))}</td>
             <td class="num col-r ${timingClass(r.sector3Seconds, s3)}">${escapeHtml(sectorTime(r.sector3Seconds))}</td>`
          : ""
      }
      <td class="num col-r laptime ${timingClass(r.lapTimeSeconds, allLaps)}">${escapeHtml(lapTime(r.lapTimeSeconds))}</td>
      <td class="num col-r hide-sm" style="color:var(--dim)">${escapeHtml(shortDate(r.createdAt))}</td>
      ${linkBase ? `<td class="chev">&rsaquo;</td>` : ""}
    </tr>`;
      })
      .join("")}
  </tbody>
</table>`;

  return `
<section class="panel">
  <div class="panel__head">
    <h2>Lap history</h2>
    ${rows.length ? timingLegend() : ""}
  </div>
  ${body}
</section>`;
}

export function refLapPanel(title: string, laps: RefLapRow[], emptyHint: string): string {
  const body =
    laps.length === 0
      ? `<div class="empty" style="padding:26px 8px"><strong>Nothing here yet</strong>${escapeHtml(emptyHint)}</div>`
      : `<div class="reflist">${laps
          .map(
            (l) => `
  <div class="ref">
    <div style="min-width:0">
      <div class="ref__label">${escapeHtml(l.label)}</div>
      <div class="ref__meta">${escapeHtml(l.track)} &middot; ${escapeHtml(l.car)}</div>
    </div>
    <div class="ref__time">${escapeHtml(lapTime(l.lapTimeSeconds))}</div>
  </div>`,
          )
          .join("")}</div>`;

  return `
<section class="panel">
  <div class="panel__head"><h2>${escapeHtml(title)}</h2><span class="tag">${laps.length}</span></div>
  <div class="panel__body">${body}</div>
</section>`;
}