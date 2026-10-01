import { layout, escapeHtml, type NavUser } from "./layout";
import { lapTime, fullDate, delta } from "./components";
import { telemetrySection } from "./session-pages";
import { classDisplayName } from "../classes";
import type { LapCheck } from "../db/promotions";

type Nav = NonNullable<NavUser>;

type Detail = {
  lap: {
    id: number;
    track: string;
    car: string;
    carDisplay: string | null;
    label: string;
    lapTimeSeconds: number | null;
    autoPromoted: boolean;
    createdAt: Date;
    data: unknown;
  };
  ownerName: string | null;
  carClass: string;
  rank: number | null;
  classSize: number;
  fastest: {
    label: string;
    car: string;
    carDisplay: string | null;
    lapTimeSeconds: number | null;
    data: unknown;
  } | null;
};

const STATUS = {
  pass: { mark: "&#10003;", colour: "var(--pb)", word: "Pass" },
  fail: { mark: "&#10007;", colour: "var(--danger, #ff4d4d)", word: "Fails" },
  unknown: { mark: "&ndash;", colour: "var(--dim)", word: "Can't tell" },
} as const;

/**
 * A public reference lap, opened up for anyone signed in: the lap's own
 * telemetry breakdown (map, traces, corner table -- the same section a
 * driver sees on their own laps), compared against the fastest lap in its
 * class when it isn't that one, and the validity checks it passes so a lap
 * that shouldn't be a reference is easy to spot.
 */
export function referenceLapPage(navUser: Nav, detail: Detail, checks: LapCheck[]): string {
  const { lap, ownerName, rank, classSize, fastest } = detail;
  const isFastest = rank === 1;
  const gap = !isFastest && fastest && lap.lapTimeSeconds !== null && fastest.lapTimeSeconds !== null
    ? lap.lapTimeSeconds - fastest.lapTimeSeconds
    : null;

  const failed = checks.filter((c) => c.status === "fail");
  const unknown = checks.filter((c) => c.status === "unknown");
  const verdict = failed.length
    ? `<span style="color:${STATUS.fail.colour}">Doesn't pass every check</span>`
    : unknown.length
      ? `<span style="color:var(--muted)">Passes every check it can be tested on</span>`
      : `<span style="color:${STATUS.pass.colour}">Passes every check</span>`;

  const checkRows = checks
    .map((c) => {
      const s = STATUS[c.status];
      return `
      <div class="check-row">
        <span class="check-mark" style="color:${s.colour}">${s.mark}</span>
        <div>
          <div class="check-name">${escapeHtml(c.label)} <span class="check-word" style="color:${s.colour}">${s.word}</span></div>
          <div class="check-note">${escapeHtml(c.note)}</div>
        </div>
      </div>`;
    })
    .join("");

  const setBy = ownerName ? `Set by ${escapeHtml(ownerName)}` : "Published lap";
  const origin = lap.autoPromoted ? "Published automatically as the fastest valid lap at the time" : "Added by a coach";

  const body = `
<a class="backlink" href="/library/track/${encodeURIComponent(lap.track)}">&larr; ${escapeHtml(lap.track)}</a>

<div class="phead">
  <div>
    <span class="eyebrow">${escapeHtml(lap.carDisplay || lap.car)}</span>
    <h1>${escapeHtml(lap.track)}</h1>
    <p class="phead__sub">${setBy} &middot; ${escapeHtml(fullDate(lap.createdAt))} &middot; ${escapeHtml(origin)}</p>
  </div>
  <div style="text-align:right">
    <div class="stat__k">Lap time</div>
    <div class="stat__v ${isFastest ? "t-fastest" : ""}" style="font-size:40px">${escapeHtml(lapTime(lap.lapTimeSeconds))}</div>
    <a class="btn btn--ghost btn--sm" href="/library/lap/${lap.id}/download" style="margin-top:8px">Download for the app</a>
  </div>
</div>

<div class="stats">
  <div class="stat">
    <div class="stat__k">Rank in ${escapeHtml(classDisplayName(detail.carClass))}</div>
    <div class="stat__v">${rank ? `${rank}<span style="color:var(--dim);font-size:18px"> / ${classSize}</span>` : "&mdash;"}</div>
    <div class="stat__sub">Published laps at this track</div>
  </div>
  <div class="stat">
    <div class="stat__k">Gap to the fastest</div>
    <div class="stat__v ${isFastest ? "t-fastest" : "t-slow"}">${isFastest ? "Fastest" : gap !== null ? escapeHtml(delta(gap)) : "&mdash;"}</div>
    <div class="stat__sub">${fastest ? `Compared with ${escapeHtml(fastest.label)}` : "Nothing faster in this class"}</div>
  </div>
  <div class="stat">
    <div class="stat__k">Checks</div>
    <div class="stat__v" style="font-size:20px;line-height:1.3">${verdict}</div>
    <div class="stat__sub">See below</div>
  </div>
</div>

<section class="panel mt">
  <div class="panel__head"><h2>Is this a clean lap?</h2><span class="tag">${failed.length ? `${failed.length} failed` : unknown.length ? "Partly checked" : "All passed"}</span></div>
  <div class="panel__body">
    ${checkRows}
    <p class="hint" style="margin-bottom:0">These are the same tests that decide which laps can reach the leaderboard and become references. A coach can disqualify a lap that gets through.</p>
  </div>
</section>

${telemetrySection({ track: lap.track, data: lap.data }, fastest)}

<style>
.check-row{display:flex;gap:14px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}
.check-row:last-of-type{border-bottom:none}
.check-mark{font-size:20px;line-height:1.2;width:20px;text-align:center;flex:0 0 auto}
.check-name{font-weight:600}
.check-word{font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-left:6px}
.check-note{color:var(--muted);font-size:13px;margin-top:2px}
</style>`;

  return layout(`${lap.track} - ${lapTime(lap.lapTimeSeconds)}`, body, navUser, { wide: true });
}
