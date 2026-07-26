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
