import { layout, escapeHtml, type NavUser } from "./layout";
import { lapTime, sectorTime, shortDate, timingClass, timingLegend, lapTimeChart } from "./components";

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
): string {
  const body = `
<div class="phead">
  <div>
    <span class="eyebrow">Driver</span>
    <h1>${escapeHtml(navUser.name)}</h1>
    <p class="phead__sub">Every timed lap the app has sent up, newest first.</p>
  </div>
</div>

${statStrip(studentSessions, referenceLapsOwned.length)}

<div class="grid-2 mt">
  <div class="stack">
    ${progressPanel(studentSessions)}
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

export function statStrip(rows: SessionRow[], refLapCount: number): string {
  const times = rows.map((r) => r.lapTimeSeconds).filter((t): t is number => t !== null);
  const best = times.length ? Math.min(...times) : null;
  const tracks = new Set(rows.map((r) => r.track));

  return `
<div class="stats">
  <div class="stat">
    <div class="stat__k">Laps logged</div>
    <div class="stat__v">${rows.length}</div>
    <div class="stat__sub">${tracks.size} ${tracks.size === 1 ? "track" : "tracks"}</div>
  </div>
  <div class="stat">
    <div class="stat__k">Fastest lap</div>
    <div class="stat__v t-fastest">${escapeHtml(lapTime(best))}</div>
    <div class="stat__sub">${best !== null ? escapeHtml(bestTrackFor(rows, best)) : "No timed laps yet"}</div>
  </div>
  <div class="stat">
    <div class="stat__k">Reference laps</div>
    <div class="stat__v">${refLapCount}</div>
    <div class="stat__sub">Saved for comparison</div>
  </div>
</div>`;
}

function bestTrackFor(rows: SessionRow[], best: number): string {
  const row = rows.find((r) => r.lapTimeSeconds === best);
  return row ? row.track : "—";
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
    ${points.length >= 2 ? `<p class="chart-note">Faster laps sit higher · ${points.length} laps at this track</p>` : ""}
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
      ${linkBase ? `<td class="chev">›</td>` : ""}
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
      <div class="ref__meta">${escapeHtml(l.track)} · ${escapeHtml(l.car)}</div>
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
