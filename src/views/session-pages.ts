import { layout, escapeHtml, type NavUser } from "./layout";
import { lapTime, sectorTime, delta, fullDate, timingClass, lapTimeChart } from "./components";

type Nav = NonNullable<NavUser>;

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

/**
 * One lap, placed in context. On its own a lap time means very little --
 * what's useful is how it sits against the rest of your laps at the same
 * track, which is what this page answers.
 */
export function sessionDetailPage(
  navUser: Nav,
  session: SessionRow,
  sameTrackSessions: SessionRow[],
  backHref: string,
  backLabel: string,
): string {
  const trackTimes = sameTrackSessions.map((s) => s.lapTimeSeconds).filter((t): t is number => t !== null);
  const trackBest = trackTimes.length ? Math.min(...trackTimes) : null;

  const gapToBest =
    session.lapTimeSeconds !== null && trackBest !== null ? session.lapTimeSeconds - trackBest : null;
  const isBest = gapToBest !== null && gapToBest <= 0;

  // Where this lap ranks among the laps at this track (1 = fastest).
  const rank =
    session.lapTimeSeconds !== null
      ? trackTimes.filter((t) => t < (session.lapTimeSeconds as number)).length + 1
      : null;

  const s1 = sameTrackSessions.map((s) => s.sector1Seconds);
  const s2 = sameTrackSessions.map((s) => s.sector2Seconds);
  const s3 = sameTrackSessions.map((s) => s.sector3Seconds);
  const hasSectors = [session.sector1Seconds, session.sector2Seconds, session.sector3Seconds].some(
    (v) => v !== null && v !== undefined,
  );

  const chartPoints = [...sameTrackSessions]
    .filter((s) => s.lapTimeSeconds !== null)
    .reverse()
    .map((s) => ({ lapTimeSeconds: s.lapTimeSeconds as number, createdAt: s.createdAt }));

  const sectorBlock = hasSectors
    ? `
<div class="stats">
  ${[
    { label: "Sector 1", value: session.sector1Seconds, all: s1 },
    { label: "Sector 2", value: session.sector2Seconds, all: s2 },
    { label: "Sector 3", value: session.sector3Seconds, all: s3 },
  ]
    .map(
      (s) => `
  <div class="stat">
    <div class="stat__k">${s.label}</div>
    <div class="stat__v ${timingClass(s.value, s.all)}">${escapeHtml(sectorTime(s.value))}</div>
    <div class="stat__sub">${sectorNote(s.value, s.all)}</div>
  </div>`,
    )
    .join("")}
</div>`
    : `
<section class="panel">
  <div class="panel__body">
    <div class="empty" style="padding:24px 8px">
      <strong>No sector times on this lap</strong>
      The desktop app sends sector splits once it's been updated to capture them — lap totals still work either way.
    </div>
  </div>
</section>`;

  const body = `
<a class="backlink" href="${escapeHtml(backHref)}">← ${escapeHtml(backLabel)}</a>

<div class="phead">
  <div>
    <span class="eyebrow">${escapeHtml(session.car)}</span>
    <h1>${escapeHtml(session.track)}</h1>
    <p class="phead__sub">${escapeHtml(fullDate(session.createdAt))}</p>
  </div>
  <div style="text-align:right">
    <div class="stat__k">Lap time</div>
    <div class="stat__v ${isBest ? "t-fastest" : ""}" style="font-size:40px">${escapeHtml(lapTime(session.lapTimeSeconds))}</div>
  </div>
</div>

<div class="stats">
  <div class="stat">
    <div class="stat__k">Gap to your best here</div>
    <div class="stat__v ${isBest ? "t-fastest" : gapToBest !== null ? "t-slow" : ""}">
      ${isBest ? "Fastest" : escapeHtml(delta(gapToBest))}
    </div>
    <div class="stat__sub">${trackBest !== null ? `Best is ${escapeHtml(lapTime(trackBest))}` : "No comparison yet"}</div>
  </div>
  <div class="stat">
    <div class="stat__k">Rank at this track</div>
    <div class="stat__v">${rank !== null ? `${rank}<span style="color:var(--dim);font-size:18px"> / ${trackTimes.length}</span>` : "—"}</div>
    <div class="stat__sub">Across every logged lap here</div>
  </div>
  <div class="stat">
    <div class="stat__k">Laps at this track</div>
    <div class="stat__v">${sameTrackSessions.length}</div>
    <div class="stat__sub">${escapeHtml(session.car)}</div>
  </div>
</div>

<div class="mt">${sectorBlock}</div>

<section class="panel mt">
  <div class="panel__head">
    <h2>This lap in context</h2>
    <span class="tag">${escapeHtml(session.track)}</span>
  </div>
  <div class="panel__body">
    ${lapTimeChart(chartPoints)}
    ${chartPoints.length >= 2 ? `<p class="chart-note">Every logged lap at this track · faster sits higher</p>` : ""}
  </div>
</section>`;

  return layout(`${session.track} — ${lapTime(session.lapTimeSeconds)}`, body, navUser);
}

function sectorNote(value: number | null, all: Array<number | null>): string {
  const valid = all.filter((v): v is number => v !== null && v !== undefined && isFinite(v));
  if (value === null || value === undefined || valid.length === 0) return "No data";
  const best = Math.min(...valid);
  if (value <= best) return "Your best here";
  return `${delta(value - best)} off your best`;
}
