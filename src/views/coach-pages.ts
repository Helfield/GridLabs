import { layout, escapeHtml, type NavUser } from "./layout";
import { lapTime, shortDate, timingClass } from "./components";
import { statStrip, progressPanel, sessionTowerPanel, refLapPanel } from "./student-pages";
import type { StudentSummary } from "../db/queries";

type Nav = NonNullable<NavUser>;

export function coachDashboardPage(navUser: Nav, students: StudentSummary[]): string {
  const bestTimes = students.map((s) => s.bestLapTimeSeconds);
  const rows =
    students.length === 0
      ? `<div class="empty"><strong>No drivers yet</strong>Anyone who joins the Discord and signs up appears here.</div>`
      : `
<table class="tower">
  <thead>
    <tr>
      <th class="pos">#</th>
      <th>Driver</th>
      <th class="col-r">Laps</th>
      <th class="col-r">Best lap</th>
      <th class="col-r hide-sm">Last seen</th>
      <th class="chev"></th>
    </tr>
  </thead>
  <tbody>
  ${students
    .map(
      (s, i) => `
    <tr class="is-link" onclick="window.location='/coach/driver/${s.id}'">
      <td class="num pos">${i + 1}</td>
      <td>
        <div class="driver">
          ${
            s.discordAvatarUrl
              ? `<img class="avatar" src="${escapeHtml(s.discordAvatarUrl)}" alt="">`
              : `<span class="avatar avatar--fallback">${escapeHtml((s.name[0] ?? "?").toUpperCase())}</span>`
          }
          <div style="min-width:0">
            <div class="driver__name">${escapeHtml(s.name)}</div>
            <div class="driver__handle">@${escapeHtml(s.discordUsername)}</div>
          </div>
        </div>
      </td>
      <td class="num col-r">${s.sessionCount}</td>
      <td class="num col-r laptime ${timingClass(s.bestLapTimeSeconds, bestTimes)}">${escapeHtml(lapTime(s.bestLapTimeSeconds))}</td>
      <td class="num col-r hide-sm" style="color:var(--dim)">${escapeHtml(shortDate(s.lastSessionAt))}</td>
      <td class="chev">›</td>
    </tr>`,
    )
    .join("")}
  </tbody>
</table>`;
  const active = students.filter((s) => s.sessionCount > 0).length;
  const body = `
<div class="phead">
  <div>
    <span class="eyebrow">Coaching</span>
    <h1>Drivers</h1>
    <p class="phead__sub">${students.length} signed up · ${active} with laps on the board</p>
  </div>
</div>
<section class="panel">
  <div class="panel__head"><h2>Roster</h2><span class="tag">Ranked by best lap</span></div>
  ${rows}
</section>`;
  return layout("Drivers", body, navUser);
}

export function driverDetailPage(
  navUser: Nav,
  driver: { name: string; email: string; discordUsername: string; discordAvatarUrl: string | null },
  driverSessions: Parameters<typeof sessionTowerPanel>[0],
  driverRefLaps: Parameters<typeof refLapPanel>[1],
): string {
  const body = `
<a class="backlink" href="/coach">← All drivers</a>
<div class="phead">
  <div style="display:flex;align-items:center;gap:16px">
    ${
      driver.discordAvatarUrl
        ? `<img class="avatar" style="width:54px;height:54px" src="${escapeHtml(driver.discordAvatarUrl)}" alt="">`
        : `<span class="avatar avatar--fallback" style="width:54px;height:54px;font-size:20px">${escapeHtml((driver.name[0] ?? "?").toUpperCase())}</span>`
    }
    <div>
      <span class="eyebrow">Driver</span>
      <h1>${escapeHtml(driver.name)}</h1>
      <p class="phead__sub mono">@${escapeHtml(driver.discordUsername)} · ${escapeHtml(driver.email)}</p>
    </div>
  </div>
</div>
${statStrip(driverSessions, driverRefLaps.length)}
<div class="grid-2 mt">
  <div class="stack">
    ${progressPanel(driverSessions)}
    ${sessionTowerPanel(driverSessions, null)}
  </div>
  <div class="stack">
    ${refLapPanel("Their reference laps", driverRefLaps, "Nothing saved yet — they need a personal best with the app running.")}
  </div>
</div>`;
  return layout(driver.name, body, navUser);
}

// Coach-only page: upload a reference lap that immediately becomes
// visible to every student ("Shared with you"), and manage/remove the
// ones already live. No schema change needed -- these are just
// reference_laps rows owned by the uploading coach with isPublic: true.
export function referenceLapsPage(
  navUser: Nav,
  laps: Array<{
    id: number;
    track: string;
    car: string;
    carDisplay: string | null;
    label: string;
    lapTimeSeconds: number | null;
    createdAt: Date;
  }>,
): string {
  const rows =
    laps.length === 0
      ? `<div class="empty"><strong>No global reference laps yet</strong>Upload one and it appears for every student instantly.</div>`
      : `
<div class="reflist">
${laps
  .map(
    (l) => `
  <div class="ref">
    <div style="min-width:0">
      <div class="ref__label">${escapeHtml(l.label)}</div>
      <div class="ref__meta">${escapeHtml(l.track)} · ${escapeHtml(l.carDisplay || l.car)} · ${escapeHtml(shortDate(l.createdAt))}</div>
      ${l.carDisplay ? `<div class="ref__meta" style="opacity:.6">matches: ${escapeHtml(l.car)}</div>` : ""}
    </div>
    <div style="display:flex;align-items:center;gap:16px">
      <span class="ref__time">${escapeHtml(lapTime(l.lapTimeSeconds))}</span>
      <form action="/coach/reference-laps/${l.id}/delete" method="post" onsubmit="return confirm('Remove this reference lap for all students?')">
        <button class="linkbtn" type="submit" style="color:var(--warn)">Remove</button>
      </form>
    </div>
  </div>`,
  )
  .join("")}
</div>`;

  const body = `
<a class="backlink" href="/coach">← All drivers</a>
<div class="phead">
  <div>
    <span class="eyebrow">Coaching</span>
    <h1>Global reference laps</h1>
    <p class="phead__sub">Upload a lap here and every student sees it instantly under "Shared with you" — no redownloading required.</p>
  </div>
</div>
<div class="grid-2">
  <section class="panel">
    <div class="panel__head"><h2>Upload</h2></div>
    <div class="panel__body">
      <form action="/coach/reference-laps" method="post" enctype="multipart/form-data">
        <label class="field">
          <span class="field__label">Track — exactly as the game reports it</span>
          <input type="text" name="track" required placeholder="e.g. Monza Curva Grande Circuit">
        </label>
        <label class="field">
          <span class="field__label">Car — exactly as the game reports it</span>
          <input type="text" name="car" required placeholder="e.g. GTE · United Autosports 2025 #23:ELMS">
        </label>
        <label class="field">
          <span class="field__label">Car name to show students (optional)</span>
          <input type="text" name="carDisplay" placeholder="e.g. McLaren 720S GT3">
        </label>
        <label class="field">
          <span class="field__label">Label</span>
          <input type="text" name="label" required placeholder="e.g. Coach reference — Monza">
        </label>
        <label class="field">
          <span class="field__label">Lap time (optional)</span>
          <input type="text" name="lapTime" placeholder="e.g. 2:03.373" autocomplete="off">
        </label>
        <label class="field">
          <span class="field__label">Reference lap file (.json)</span>
          <input type="file" name="dataFile" accept="application/json" required>
        </label>
        <p class="hint">Lap time as you'd read it on a timing screen — 2:03.373. Leave it blank if the lap file already carries its own time. Track and car must match the sim's own wording character-for-character — that's what the app matches on when it decides which laps apply to what you're driving. The display name is cosmetic and matches nothing.</p>
        <button class="btn btn--discord" style="background:var(--fastest);margin-top:6px" type="submit">Upload &amp; publish to everyone</button>
      </form>
    </div>
  </section>
  <section class="panel">
    <div class="panel__head"><h2>Live now</h2><span class="tag">${laps.length} global</span></div>
    <div class="panel__body">
      ${rows}
    </div>
  </section>
</div>`;
  return layout("Global reference laps", body, navUser);
}