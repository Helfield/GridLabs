import { layout, escapeHtml, type NavUser } from "./layout";
import { shortDate, lapTime } from "./components";
import type { League, LeagueEvent, Entry, EventResult, StandingBoard, AppRaceRecord, CheckVerdict } from "../db/league";
import { checkAgainstApp, parsePointsTable } from "../db/league";
import { LICENCE_BANDS, bandWindowText, MIN_CLASS_SIZE } from "../leagueRules";
import { LEAGUE_CLASSES } from "../classes";

type Nav = NonNullable<NavUser>;

const isStaff = (u: Nav) => u.role === "coach" || u.role === "moderator";
const isCoach = (u: Nav) => u.role === "coach";

function notice(message: string | null | undefined, kind: "ok" | "error" = "ok"): string {
  if (!message) return "";
  const colour = kind === "error" ? "var(--warn)" : "var(--pb)";
  return `<div class="panel" style="margin-bottom:28px;border-color:${colour}"><div class="panel__body" style="color:${colour}">${escapeHtml(message)}</div></div>`;
}

/** "2026-10-17T19:30" for a <input type=datetime-local>, in UTC. */
function dateInputValue(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 16) : "";
}

function bandOptions(selected?: string | null, blankLabel = "Not given"): string {
  return [
    `<option value=""${!selected ? " selected" : ""}>${blankLabel}</option>`,
    ...LICENCE_BANDS.map((b) => `<option value="${b}"${selected === b ? " selected" : ""}>${b}</option>`),
  ].join("");
}

/**
 * A dropdown of the LMU licence bands. Blank means the driver left it out, or
 * for a league's window that anyone may register.
 */
function bandSelect(name: string, label: string, selected?: string | null, blankLabel = "Not given"): string {
  return `<label class="field"><span class="field__label">${label}</span><select name="${name}">${bandOptions(selected, blankLabel)}</select></label>`;
}

const ANYONE = "Anyone";

/**
 * A dropdown of the car classes a league scores. Unioned with whatever is
 * already stored, so editing a row never silently drops a class the current
 * season isn't running.
 */
function classSelect(name: string, selected: string | null): string {
  const choices = selected && !LEAGUE_CLASSES.includes(selected) ? [selected, ...LEAGUE_CLASSES] : LEAGUE_CLASSES;
  const options = [`<option value=""${!selected ? " selected" : ""}>—</option>`, ...choices.map((cl) => `<option value="${cl}"${selected === cl ? " selected" : ""}>${cl}</option>`)];
  return `<select name="${name}" style="background:var(--panel-2);color:var(--text);border:1px solid transparent;border-radius:6px;padding:6px">${options.join("")}</select>`;
}

function dateTimeUtc(d: Date | null | undefined): string {
  if (!d) return "Date to be announced";
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

function pointsSummary(l: League): string {
  const table = parsePointsTable(l.pointsTable);
  const parts = [`P1–P${table.length}: ${table.join(", ")}`];
  if (l.droppedRounds) parts.push(`worst ${l.droppedRounds} dropped`);
  if (l.fastestLapBonus) parts.push(`fastest lap +${l.fastestLapBonus}`);
  if (l.poleBonus) parts.push(`pole +${l.poleBonus}`);
  if (l.participationPoints) parts.push(`other finishers/DNF ${l.participationPoints}`);
  return parts.join(" · ");
}

// ------------------------------------------------------------------- index

export function leagueIndexPage(
  user: Nav,
  leagues: Array<League & { entryCount: number }>,
  registeredIds: Set<number>,
  msg?: string | null,
): string {
  const cards =
    leagues.length === 0
      ? `<div class="empty"><strong>No leagues yet</strong>${isCoach(user) ? "Create the first one below." : "Check back soon."}</div>`
      : leagues
          .map(
            (l) => `
    <a class="panel" style="display:block;text-decoration:none;color:inherit;margin-bottom:14px" href="/league/${l.id}">
      <div class="panel__head">
        <h2>${escapeHtml(l.name)}</h2>
        <span class="tag">${registeredIds.has(l.id) ? "You're in" : l.registrationOpen ? "Registration open" : "Closed"}</span>
      </div>
      <div class="panel__body">
        ${l.description ? `<p style="margin:0 0 10px;color:var(--muted)">${escapeHtml(l.description)}</p>` : ""}
        <span style="color:var(--dim);font-size:13px">${l.entryCount} ${l.entryCount === 1 ? "driver" : "drivers"} registered${bandWindowText(l) ? ` · ${bandWindowText(l)}` : ""}</span>
      </div>
    </a>`,
          )
          .join("");

  const create = isCoach(user)
    ? `
<section class="panel" style="margin-top:28px">
  <div class="panel__head"><h2>New league</h2><span class="tag">Coach</span></div>
  <div class="panel__body">
    <form action="/league/new" method="post">
      <label class="field"><span class="field__label">Name</span>
        <input type="text" name="name" required maxlength="80" placeholder="e.g. IRP Endurance Series — Season 1"></label>
      <label class="field"><span class="field__label">Description (optional)</span>
        <textarea name="description" rows="3" maxlength="1000"></textarea></label>
      ${bandSelect("bandMin", "Lowest band that may register", null, ANYONE)}
      ${bandSelect("bandMax", "Highest band that may register", null, ANYONE)}
      <button class="btn btn--discord" style="background:var(--fastest)" type="submit">Create league</button>
      <p class="hint">The two bands are who the league is open to, from the LMU licence list. A division of everyone below Gold is a window from Bronze 1 to Silver 3. Leave both on Anyone to run an open league. Points rules are set on the league's page after it's created; the default is the usual 25-18-15-12-10-8-6-4-2-1.</p>
    </form>
  </div>
</section>`
    : "";

  const body = `
<div class="phead">
  <div>
    <span class="eyebrow">Racing</span>
    <h1>Leagues</h1>
    <p class="phead__sub">Register, follow the calendar and the championship table.</p>
  </div>
  ${isCoach(user) ? `<a class="btn btn--ghost btn--sm" href="/league/staff">League staff</a>` : ""}
</div>
${notice(msg)}
${cards}
${create}`;
  return layout("Leagues", body, user, { wallpaper: "spapark" });
}

// ------------------------------------------------------------------ league

export function leaguePage(
  user: Nav,
  ctx: {
    league: League;
    entries: Entry[];
    events: LeagueEvent[];
    boards: StandingBoard[];
    registered: boolean;
    calendarOn: boolean;
    calendarConnected: boolean;
    calendarEmail: string | null;
    msg?: string | null;
    error?: string | null;
  },
): string {
  const { league, entries, events, boards, registered } = ctx;
  const staff = isStaff(user);
  const window = bandWindowText(league);

  // Google Calendar connect/disconnect, shown once the site has Google
  // credentials configured. Connecting lets every race you're registered for
  // drop straight into your calendar as the organisers create them.
  const calendarPanel = !ctx.calendarOn
    ? ""
    : ctx.calendarConnected
      ? `
<section class="panel" style="margin-bottom:28px">
  <div class="panel__head"><h2>Your calendar</h2><span class="tag">Connected</span></div>
  <div class="panel__body">
    <p style="margin:0 0 12px;color:var(--muted)">Races in leagues you join are added to <strong style="color:var(--text)">${escapeHtml(ctx.calendarEmail ?? "your Google Calendar")}</strong> automatically.</p>
    <form action="/league/calendar/disconnect" method="post">
      <button class="btn btn--ghost btn--sm" type="submit">Disconnect Google Calendar</button>
    </form>
  </div>
</section>`
      : `
<section class="panel" style="margin-bottom:28px">
  <div class="panel__head"><h2>Your calendar</h2><span class="tag">Not connected</span></div>
  <div class="panel__body">
    <p style="margin:0 0 12px;color:var(--muted)">Connect Google Calendar once and every future race you're registered for is added to it automatically.</p>
    <a class="btn btn--discord btn--sm" style="background:var(--fastest)" href="/league/calendar/connect">Connect Google Calendar</a>
  </div>
</section>`;

  const joinPanel = registered
    ? `
<section class="panel" style="margin-bottom:28px">
  <div class="panel__head"><h2>Your registration</h2><span class="tag">Registered</span></div>
  <div class="panel__body">
    <form action="/league/${league.id}/withdraw" method="post" onsubmit="return confirm('Withdraw from this league?')">
      <button class="btn btn--ghost btn--sm" type="submit">Withdraw</button>
    </form>
  </div>
</section>`
    : league.registrationOpen
      ? `
<section class="panel" style="margin-bottom:28px">
  <div class="panel__head"><h2>Register</h2><span class="tag">Open</span></div>
  <div class="panel__body">
    <p style="margin:0 0 14px;color:var(--muted)">Registering as <strong style="color:var(--text)">${escapeHtml(user.name)}</strong>${user.discordUsername ? ` <span style="color:var(--dim)">@${escapeHtml(user.discordUsername)}</span>` : ""} — change it on your <a href="/account">account page</a>.</p>
    <form action="/league/${league.id}/register" method="post">
      <label class="field"><span class="field__label">Team name (optional)</span>
        <input type="text" name="team" maxlength="60" autocomplete="off"></label>
      ${window ? `<p style="margin:0 0 14px;color:var(--muted)">This league is open to <strong style="color:var(--text)">${escapeHtml(window)}</strong>. Both bands are taken from your LMU licence screen, Safety Rating and Driver Rating, and the league places you by the lower of the two.</p>` : ""}
      ${bandSelect("srBand", `Safety Rating band${window ? "" : " (optional)"}`)}
      ${bandSelect("drBand", `Driver Rating band${window ? "" : " (optional)"}`)}
      <button class="btn btn--discord" style="background:var(--fastest)" type="submit">Register for ${escapeHtml(league.name)}</button>
      ${window ? `<p class="hint">You declare your own bands. If you think you belong in this league but don't qualify on what you've entered, ask a moderator to add you.</p>` : ""}
    </form>
  </div>
</section>`
      : `<section class="panel" style="margin-bottom:28px"><div class="panel__body" style="color:var(--dim)">Registration is closed.</div></section>`;

  const eventHeaders = events.map((e) => `<th class="col-r hide-sm" title="${escapeHtml(e.name)}">R${e.round}</th>`).join("");

  // A dropped round is still shown, struck through: it happened, and a driver
  // works out their own total better when they can see what left it.
  const roundCell = (e: LeagueEvent, s: StandingBoard["rows"][number]) => {
    const style = 'class="num col-r hide-sm" style="color:var(--dim)"';
    if (!s.byEvent.has(e.id)) return `<td ${style}>–</td>`;
    const points = s.byEvent.get(e.id);
    if (!s.droppedEvents.has(e.id)) return `<td ${style}>${points}</td>`;
    return `<td ${style} title="Does not count: the worst ${league.droppedRounds} result${league.droppedRounds === 1 ? "" : "s"} in this league are dropped"><s style="opacity:.45">${points}</s></td>`;
  };

  const boardTable = (rows: StandingBoard["rows"]) => `
<table class="tower">
  <thead><tr><th class="pos">#</th><th>Driver</th>${eventHeaders}<th class="col-r hide-sm">Rounds</th><th class="col-r">Wins</th><th class="col-r">Pts</th></tr></thead>
  <tbody>
  ${rows
    .map(
      (s, i) => `
    <tr>
      <td class="num pos">${i + 1}</td>
      <td><div class="driver__name">${escapeHtml(s.name)}</div>
          <div class="driver__handle">${[s.team ? escapeHtml(s.team) : "", s.srBand ? `SR ${escapeHtml(s.srBand)}` : "", s.drBand ? `DR ${escapeHtml(s.drBand)}` : "", s.carClass ? escapeHtml(s.carClass) : ""].filter(Boolean).join(" · ")}</div></td>
      ${events.map((e) => roundCell(e, s)).join("")}
      <td class="num col-r hide-sm" style="color:var(--dim)">${s.rounds}</td>
      <td class="num col-r">${s.wins}</td>
      <td class="num col-r"><strong>${s.points}</strong></td>
    </tr>`,
    )
    .join("")}
  </tbody>
</table>`;

  // One table per class when the races are mixed-class. The single table of a
  // class-less league keeps the heading it always had, so nothing looks new
  // until classes are actually in use.
  const championship =
    entries.length === 0
      ? `<section class="panel"><div class="panel__head"><h2>Championship</h2><span class="tag">${escapeHtml(pointsSummary(league))}</span></div><div class="empty"><strong>No drivers yet</strong>The table fills in once people register.</div></section>`
      : boards
          .map((b, i) => {
            const title = b.carClass ? `${b.carClass} championship` : boards.length > 1 ? "No class recorded" : "Championship";
            const thin = b.carClass && b.rows.length < MIN_CLASS_SIZE;
            return `
<section class="panel"${i ? ' style="margin-top:28px"' : ""}>
  <div class="panel__head"><h2>${escapeHtml(title)}</h2><span class="tag">${escapeHtml(pointsSummary(league))}</span></div>
  ${b.rows.length ? boardTable(b.rows) : `<div class="empty"><strong>No scores yet</strong>This table fills in as results are entered.</div>`}
  ${thin ? `<div class="panel__body" style="color:var(--dim);font-size:13px">Fewer than ${MIN_CLASS_SIZE} cars in this class. As the sporting doc puts it, they merge into the next class along rather than scoring a procession.</div>` : ""}
</section>`;
          })
          .join("");

  const calendar =
    events.length === 0
      ? `<div class="empty"><strong>No events yet</strong>The calendar will appear here.</div>`
      : `<div class="panel__body" style="padding:0">
  <table class="tower">
    <thead><tr><th class="pos">Rd</th><th>Event</th><th class="hide-sm">Track</th><th class="col-r">When</th><th class="chev"></th></tr></thead>
    <tbody>
    ${events
      .map(
        (e) => `
      <tr class="is-link" onclick="window.location='/league/event/${e.id}'">
        <td class="num pos">${e.round}</td>
        <td>${escapeHtml(e.name)}</td>
        <td class="hide-sm">${escapeHtml(e.track)}</td>
        <td class="num col-r" style="color:var(--dim)">${e.eventDate ? escapeHtml(shortDate(e.eventDate)) : "TBA"}</td>
        <td class="chev">›</td>
      </tr>`,
      )
      .join("")}
    </tbody>
  </table></div>`;

  const staffPanels = staff
    ? `
<section class="panel" style="margin-top:28px">
  <div class="panel__head"><h2>Add an event</h2><span class="tag">${escapeHtml(user.role)}</span></div>
  <div class="panel__body">
    <form action="/league/${league.id}/events" method="post">
      <label class="field"><span class="field__label">Round</span>
        <input type="number" name="round" min="1" value="${events.length + 1}" required></label>
      <label class="field"><span class="field__label">Name</span>
        <input type="text" name="name" required maxlength="80" placeholder="e.g. Round 3 — Monza"></label>
      <label class="field"><span class="field__label">Track — as the game names it (used to match app results)</span>
        <input type="text" name="track" required maxlength="120" placeholder="e.g. Autodromo Nazionale Monza"></label>
      <label class="field"><span class="field__label">Race start (UTC, optional)</span>
        <input type="datetime-local" name="eventDate"></label>
      <button class="btn btn--discord" style="background:var(--fastest)" type="submit">Add event</button>
    </form>
  </div>
</section>
<section class="panel" style="margin-top:28px">
  <div class="panel__head"><h2>Registered drivers</h2><span class="tag">${entries.length}</span></div>
  <div class="panel__body">
    ${
      entries.length
        ? entries
            .map(
              (e) => `<div style="padding:8px 0;border-bottom:1px solid var(--hair)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <span>${escapeHtml(e.name)} <span style="color:var(--dim)">@${escapeHtml(e.discordUsername)}${e.team ? ` · ${escapeHtml(e.team)}` : ""}</span></span>
          <form action="/league/${league.id}/remove/${e.userId}" method="post" onsubmit="return confirm('Remove ${escapeHtml(e.name).replace(/'/g, "")} from the league?')">
            <button class="linkbtn" type="submit" style="color:var(--warn)">Remove</button></form>
        </div>
        <form action="/league/${league.id}/set-bands/${e.userId}" method="post" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">
          <select name="srBand" title="Safety Rating band" style="background:var(--panel-2);color:var(--text);border:1px solid transparent;border-radius:6px;padding:5px">${bandOptions(e.srBand)}</select>
          <select name="drBand" title="Driver Rating band" style="background:var(--panel-2);color:var(--text);border:1px solid transparent;border-radius:6px;padding:5px">${bandOptions(e.drBand)}</select>
          <button class="btn btn--ghost btn--sm" type="submit">Save bands</button>
          ${window && !e.srBand && !e.drBand ? `<span style="color:var(--warn);font-size:12px">No licence recorded</span>` : ""}
        </form>
      </div>`,
            )
            .join("")
        : `<span style="color:var(--dim)">Nobody yet.</span>`
    }
    <form action="/league/${league.id}/add-driver" method="post" style="margin-top:14px">
      <label class="field"><span class="field__label">Add a member by Discord username</span>
        <input type="text" name="username" required autocomplete="off" placeholder="their Discord username"></label>
      ${bandSelect("srBand", "Safety Rating band")}
      ${bandSelect("drBand", "Driver Rating band")}
      <button class="btn btn--ghost btn--sm" type="submit">Add driver</button>
      <p class="hint">Adding someone here skips the band check, which is how a driver who doesn't fit the window still gets in. Fill their bands in while you're here so the standings say what they race on.</p>
    </form>
  </div>
</section>`
    : "";

  const settingsPanel = isStaff(user)
    ? `
<section class="panel" style="margin-top:28px">
  <div class="panel__head"><h2>League settings</h2><span class="tag">${escapeHtml(user.role)}</span></div>
  <div class="panel__body">
    <form action="/league/${league.id}/settings" method="post">
      <label class="field"><span class="field__label">Name</span>
        <input type="text" name="name" value="${escapeHtml(league.name)}" required maxlength="80"></label>
      <label class="field"><span class="field__label">Description</span>
        <textarea name="description" rows="3" maxlength="1000">${escapeHtml(league.description ?? "")}</textarea></label>
      ${bandSelect("bandMin", "Lowest band that may register", league.bandMin, ANYONE)}
      ${bandSelect("bandMax", "Highest band that may register", league.bandMax, ANYONE)}
      <label class="field"><span class="field__label">Points for 1st, 2nd, 3rd… (comma separated)</span>
        <input type="text" name="pointsTable" value="${escapeHtml(league.pointsTable)}" required></label>
      <label class="field"><span class="field__label">Fastest lap bonus</span>
        <input type="number" name="fastestLapBonus" min="0" max="20" value="${league.fastestLapBonus}"></label>
      <label class="field"><span class="field__label">Pole position bonus</span>
        <input type="number" name="poleBonus" min="0" max="20" value="${league.poleBonus}"></label>
      <label class="field"><span class="field__label">Points for finishers outside the table, and for a DNF</span>
        <input type="number" name="participationPoints" min="0" max="20" value="${league.participationPoints}"></label>
      <label class="field"><span class="field__label">Worst results dropped from each driver's score</span>
        <input type="number" name="droppedRounds" min="0" max="20" value="${league.droppedRounds}"></label>
      <label class="field" style="display:flex;gap:10px;align-items:center">
        <input type="checkbox" name="registrationOpen" value="1" ${league.registrationOpen ? "checked" : ""} style="width:auto">
        <span>Registration open</span></label>
      <button class="btn btn--discord" style="background:var(--fastest)" type="submit">Save &amp; re-score results</button>
      <p class="hint">Changing the bands only affects who can register from now on. Anyone already in the league stays in it, including a driver who no longer fits the window.</p>
      <p class="hint">Dropped rounds affect the table, not the results. Every round stays on file and the ones that don't count are struck through, so putting it back to 0 brings them all back.</p>
    </form>
  </div>
</section>`
    : "";

  const body = `
<a class="backlink" href="/league">← All leagues</a>
<div class="phead">
  <div>
    <span class="eyebrow">League</span>
    <h1>${escapeHtml(league.name)}</h1>
    <p class="phead__sub">${entries.length} ${entries.length === 1 ? "driver" : "drivers"} · ${events.length} ${events.length === 1 ? "event" : "events"}${window ? ` · open to ${escapeHtml(window)}` : ""}</p>
  </div>
</div>
${league.description ? `<p style="color:var(--muted);margin:0 0 18px">${escapeHtml(league.description)}</p>` : ""}
${notice(ctx.msg)}${notice(ctx.error, "error")}
${joinPanel}
${calendarPanel}
${championship}
<section class="panel" style="margin-top:28px">
  <div class="panel__head"><h2>Calendar</h2><span class="tag">${events.length}</span></div>
  ${calendar}
</section>
${staffPanels}
${settingsPanel}`;
  return layout(league.name, body, user, { wallpaper: "spapark" });
}

// ------------------------------------------------------------------- event

const VERDICT_STYLE: Record<CheckVerdict, { colour: string; label: string }> = {
  match: { colour: "var(--pb)", label: "✓ matches" },
  differs: { colour: "var(--warn)", label: "⚠ differs" },
  "no-data": { colour: "var(--dim)", label: "no app data" },
};

function classificationTable(record: AppRaceRecord): string {
  const rows = Array.isArray(record.classification) ? (record.classification as any[]) : [];
  if (!rows.length) return "";
  return `
<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--muted);font-size:12px">Full classification the app saw</summary>
<table class="tower" style="margin-top:8px"><thead><tr><th class="pos">#</th><th>Driver</th><th class="hide-sm">Class</th><th class="col-r">Laps</th><th class="col-r">Best</th></tr></thead><tbody>
${rows
  .map(
    (r) => `<tr><td class="num pos">${escapeHtml(String(r.place ?? ""))}</td><td>${escapeHtml(String(r.driver ?? ""))}</td><td class="hide-sm">${escapeHtml(String(r.class ?? ""))}</td><td class="num col-r">${escapeHtml(String(r.laps ?? ""))}</td><td class="num col-r">${typeof r.bestLap === "number" ? escapeHtml(lapTime(r.bestLap)) : ""}</td></tr>`,
  )
  .join("")}
</tbody></table></details>`;
}

export function eventPage(
  user: Nav,
  ctx: {
    league: League;
    event: LeagueEvent;
    entries: Entry[];
    results: EventResult[];
    appRecords: Map<number, AppRaceRecord>;
    msg?: string | null;
    error?: string | null;
  },
): string {
  const { league, event, entries, results, appRecords } = ctx;
  const staff = isStaff(user);
  const byUser = new Map(results.map((r) => [r.userId, r]));
  const classed = results.some((r) => r.carClass);

  // Published order: the place the points came from, which is the class place
  // in a mixed race and the overall place otherwise.
  const published = [...results].sort((a, b) => {
    const rank = (r: EventResult) => {
      const place = r.classPosition ?? r.position;
      return r.status === "finished" && place ? place : 1000;
    };
    return rank(a) - rank(b) || a.name.localeCompare(b.name);
  });
  const resultsTable =
    published.length === 0
      ? `<div class="empty"><strong>No results yet</strong>They'll appear here once the organisers have entered them.</div>`
      : `
<table class="tower">
  <thead><tr><th class="pos">${classed ? "Cls" : "Pos"}</th><th>Driver</th>${classed ? `<th class="hide-sm">Overall</th>` : ""}<th class="hide-sm">Bonus</th><th class="col-r">Pts</th></tr></thead>
  <tbody>
  ${published
    .map(
      (r) => `
    <tr>
      <td class="num pos">${r.status === "finished" ? (r.classPosition ?? r.position) : r.status.toUpperCase()}</td>
      <td><div class="driver__name">${escapeHtml(r.name)}</div>${r.carClass ? `<div class="driver__handle">${escapeHtml(r.carClass)}</div>` : ""}</td>
      ${classed ? `<td class="hide-sm" style="color:var(--dim)">${r.status === "finished" && r.position ? `P${r.position}` : "–"}</td>` : ""}
      <td class="hide-sm" style="color:var(--dim)">${[r.pole ? "Pole" : "", r.fastestLap ? "Fastest lap" : "", r.adjustment ? `${r.adjustment > 0 ? "+" : ""}${r.adjustment} adj.` : ""].filter(Boolean).join(" · ")}</td>
      <td class="num col-r"><strong>${r.points}</strong></td>
    </tr>`,
    )
    .join("")}
  </tbody>
</table>`;

  const entryForm = staff
    ? `
<section class="panel" style="margin-top:28px">
  <div class="panel__head"><h2>Enter results</h2><span class="tag">${escapeHtml(user.role)}</span></div>
  <div class="panel__body">
    <form action="/league/event/${event.id}/fill-from-app" method="post" style="margin-bottom:14px">
      <button class="btn btn--ghost btn--sm" type="submit">Fill from the app</button>
      <span style="color:var(--dim);font-size:13px;margin-left:10px">Use what each driver's app recorded as the starting point.</span>
    </form>
    <p class="hint" style="margin-top:0">One row per registered driver. Leave the status blank for anyone who wasn't in this race, and their row is removed when you save. Points come from the league's rules: the class place when the race carries classes, the overall place when it doesn't. Set a class on one row and every finisher then needs one, because a table that scored half the grid on class places and half on overall places wouldn't mean anything. The last column is what the desktop app recorded, as a check.</p>
    <form action="/league/event/${event.id}/results" method="post">
      <div style="overflow-x:auto">
      <table class="tower">
        <thead><tr><th>Driver</th><th>Status</th><th>Pos</th><th>Class</th><th>Cls pos</th><th>Pole</th><th>FL</th><th>Adj.</th><th>App check</th></tr></thead>
        <tbody>
        ${entries
          .map((e) => {
            const r = byUser.get(e.userId);
            const app = appRecords.get(e.userId);
            const check = r ? checkAgainstApp(r, app) : null;
            const style = check ? VERDICT_STYLE[check.verdict] : VERDICT_STYLE["no-data"];
            const appText = app
              ? `P${app.place}${app.classPlace && app.classPlace !== app.place ? ` · class P${app.classPlace}` : ""}${app.fieldSize ? ` of ${app.fieldSize}` : ""}${app.finishStatus === 2 ? " · DNF" : app.finishStatus === 3 ? " · DQ" : ""}`
              : "—";
            return `
        <tr>
          <td>${escapeHtml(e.name)}${e.team ? ` <span style="color:var(--dim)">${escapeHtml(e.team)}</span>` : ""}</td>
          <td><select name="status_${e.userId}" style="background:var(--panel-2);color:var(--text);border:1px solid transparent;border-radius:6px;padding:6px">
            <option value="">—</option>
            ${["finished", "dnf", "dns", "dsq"].map((s) => `<option value="${s}" ${r?.status === s ? "selected" : ""}>${s.toUpperCase()}</option>`).join("")}
          </select></td>
          <td><input type="number" name="pos_${e.userId}" min="1" max="200" value="${r?.position ?? ""}" style="width:64px;background:var(--panel-2);color:var(--text);border:1px solid transparent;border-radius:6px;padding:6px"></td>
          <td>${classSelect(`class_${e.userId}`, r?.carClass ?? null)}</td>
          <td><input type="number" name="classpos_${e.userId}" min="1" max="200" value="${r?.classPosition ?? ""}" style="width:64px;background:var(--panel-2);color:var(--text);border:1px solid transparent;border-radius:6px;padding:6px"></td>
          <td><input type="checkbox" name="pole_${e.userId}" value="1" ${r?.pole ? "checked" : ""}></td>
          <td><input type="checkbox" name="fl_${e.userId}" value="1" ${r?.fastestLap ? "checked" : ""}></td>
          <td><input type="number" name="adj_${e.userId}" min="-50" max="50" value="${r?.adjustment || ""}" style="width:64px;background:var(--panel-2);color:var(--text);border:1px solid transparent;border-radius:6px;padding:6px"></td>
          <td><span style="color:${style.colour}">${appText}</span>${check ? `<div style="font-size:12px;color:${style.colour}">${style.label}</div>` : ""}
              ${app ? classificationTable(app) : ""}</td>
        </tr>`;
          })
          .join("")}
        </tbody>
      </table></div>
      <button class="btn btn--discord" style="background:var(--fastest);margin-top:14px" type="submit">Save results</button>
    </form>
  </div>
</section>
${
  isCoach(user)
    ? `<form action="/league/event/${event.id}/delete" method="post" style="margin-top:14px" onsubmit="return confirm('Delete this event and its results?')">
  <button class="linkbtn" type="submit" style="color:var(--warn)">Delete event</button></form>`
    : ""
}`
    : "";

  const editEvent = isCoach(user)
    ? `
<section class="panel" style="margin-top:28px">
  <div class="panel__head"><h2>Event details</h2><span class="tag">Coach</span></div>
  <div class="panel__body">
    <form action="/league/event/${event.id}/edit" method="post">
      <label class="field"><span class="field__label">Round</span><input type="number" name="round" min="1" value="${event.round}" required></label>
      <label class="field"><span class="field__label">Name</span><input type="text" name="name" value="${escapeHtml(event.name)}" required maxlength="80"></label>
      <label class="field"><span class="field__label">Track</span><input type="text" name="track" value="${escapeHtml(event.track)}" required maxlength="120"></label>
      <label class="field"><span class="field__label">Race start (UTC)</span><input type="datetime-local" name="eventDate" value="${dateInputValue(event.eventDate)}"></label>
      <button class="btn btn--ghost btn--sm" type="submit">Save details</button>
    </form>
  </div>
</section>`
    : "";

  const body = `
<a class="backlink" href="/league/${league.id}">← ${escapeHtml(league.name)}</a>
<div class="phead">
  <div>
    <span class="eyebrow">Round ${event.round}</span>
    <h1>${escapeHtml(event.name)}</h1>
    <p class="phead__sub">${escapeHtml(event.track)} · ${escapeHtml(dateTimeUtc(event.eventDate))}</p>
  </div>
</div>
${notice(ctx.msg)}${notice(ctx.error, "error")}
<section class="panel">
  <div class="panel__head"><h2>Results</h2><span class="tag">${published.length}</span></div>
  ${resultsTable}
</section>
${entryForm}
${editEvent}`;
  return layout(event.name, body, user, { wide: true, wallpaper: "spapark" });
}

// ------------------------------------------------------------------- staff

export function staffPage(
  user: Nav,
  members: Array<{ id: number; name: string; discordUsername: string; role: string }>,
  msg?: string | null,
): string {
  const staff = members.filter((m) => m.role === "moderator");
  const others = members.filter((m) => m.role === "student");
  const row = (m: (typeof members)[number], action: "promote" | "demote") => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--hair)">
      <span>${escapeHtml(m.name)} <span style="color:var(--dim)">@${escapeHtml(m.discordUsername)}</span></span>
      <form action="/league/staff/${m.id}/${action}" method="post">
        <button class="btn btn--ghost btn--sm" type="submit">${action === "promote" ? "Make moderator" : "Remove moderator"}</button>
      </form>
    </div>`;
  const body = `
<a class="backlink" href="/league">← Leagues</a>
<div class="phead">
  <div>
    <span class="eyebrow">Coach</span>
    <h1>League staff</h1>
    <p class="phead__sub">Moderators can add events, enter results, manage entries and change a league's points rules, including its licence bands. Only coaches can delete things, edit event details or choose moderators.</p>
  </div>
</div>
${notice(msg)}
<section class="panel">
  <div class="panel__head"><h2>Moderators</h2><span class="tag">${staff.length}</span></div>
  <div class="panel__body">${staff.length ? staff.map((m) => row(m, "demote")).join("") : `<span style="color:var(--dim)">No moderators yet.</span>`}</div>
</section>
<section class="panel" style="margin-top:28px">
  <div class="panel__head"><h2>Members</h2><span class="tag">${others.length}</span></div>
  <div class="panel__body">
    <input type="search" id="q" placeholder="Filter by name…" style="width:100%;margin-bottom:10px;background:var(--panel-2);color:var(--text);border:1px solid transparent;border-radius:6px;padding:10px">
    <div id="list">${others.map((m) => row(m, "promote")).join("")}</div>
  </div>
</section>
<script>
document.getElementById('q').addEventListener('input', function (e) {
  var q = e.target.value.toLowerCase();
  document.querySelectorAll('#list > div').forEach(function (d) {
    d.style.display = d.textContent.toLowerCase().indexOf(q) === -1 ? 'none' : '';
  });
});
</script>`;
  return layout("League staff", body, user, { wallpaper: "spapark" });
}
