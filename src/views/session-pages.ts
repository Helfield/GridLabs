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
  data?: unknown;
  createdAt: Date;
};

type Point = {
  bin: number;
  distance: number;      // metres from the start line
  x: number | null;
  z: number | null;
  speed: number;
  brake: number;
  throttle: number | null;
  gear: number;
};

const BIN_SIZE_M = 5;

/** Bins are 5m apart, so bin index doubles as distance once scaled. */
function readSamples(raw: unknown): Point[] {
  const samples = (raw as any)?.samples;
  if (!samples || typeof samples !== "object") return [];
  return Object.keys(samples)
    .map((k) => ({ bin: Number(k), s: samples[k] }))
    .filter((p) => Number.isFinite(p.bin) && p.s && typeof p.s.speed_kph === "number")
    .sort((a, b) => a.bin - b.bin)
    .map(({ bin, s }) => ({
      bin,
      distance: bin * BIN_SIZE_M,
      x: typeof s.world_x === "number" ? s.world_x : null,
      z: typeof s.world_z === "number" ? s.world_z : null,
      speed: s.speed_kph,
      brake: typeof s.brake === "number" ? s.brake : 0,
      throttle: typeof s.throttle === "number" ? s.throttle : null,
      gear: typeof s.gear === "number" ? s.gear : 0,
    }));
}

/**
 * Corner apexes: local minima in speed.
 *
 * A window rather than a bare three-point comparison, because speed
 * wobbles a little between adjacent bins and every wobble would
 * otherwise register as a corner. Looking a few bins either side finds
 * the genuine slow point of a corner and ignores the noise.
 */
function findApexes(points: Point[], window = 6): number[] {
  const apexes: number[] = [];
  for (let i = window; i < points.length - window; i++) {
    const speed = points[i].speed;
    let lowest = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j !== i && points[j].speed < speed) { lowest = false; break; }
    }
    // Keep them apart, or one long corner reports several apexes.
    if (lowest && (apexes.length === 0 || i - apexes[apexes.length - 1] > window * 2)) {
      apexes.push(i);
    }
  }
  return apexes;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

/**
 * One lap, placed in context. On its own a lap time means very little --
 * what's useful is how it sits against the rest of your laps at the same
 * track, and what you were actually doing with the controls.
 */
type ReferenceRow = {
  label: string;
  car: string;
  carDisplay: string | null;
  lapTimeSeconds: number | null;
  data: unknown;
} | null;

export function sessionDetailPage(
  navUser: Nav,
  session: SessionRow,
  sameTrackSessions: SessionRow[],
  backHref: string,
  backLabel: string,
  reference: ReferenceRow = null,
): string {
  const trackTimes = sameTrackSessions.map((s) => s.lapTimeSeconds).filter((t): t is number => t !== null);
  const trackBest = trackTimes.length ? Math.min(...trackTimes) : null;

  const gapToBest =
    session.lapTimeSeconds !== null && trackBest !== null ? session.lapTimeSeconds - trackBest : null;
  const isBest = gapToBest !== null && gapToBest <= 0;

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
      Laps driven with an older version of the app don't carry splits. New laps do.
    </div>
  </div>
</section>`;

  const body = `
<a class="backlink" href="${escapeHtml(backHref)}">&larr; ${escapeHtml(backLabel)}</a>

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
    <div class="stat__v">${rank !== null ? `${rank}<span style="color:var(--dim);font-size:18px"> / ${trackTimes.length}</span>` : "&mdash;"}</div>
    <div class="stat__sub">Across every logged lap here</div>
  </div>
  <div class="stat">
    <div class="stat__k">Laps at this track</div>
    <div class="stat__v">${sameTrackSessions.length}</div>
    <div class="stat__sub">${escapeHtml(session.car)}</div>
  </div>
</div>

<div class="mt">${sectorBlock}</div>

${telemetrySection(session, reference)}

<section class="panel mt">
  <div class="panel__head">
    <h2>This lap in context</h2>
    <span class="tag">${escapeHtml(session.track)}</span>
  </div>
  <div class="panel__body">
    ${lapTimeChart(chartPoints)}
    ${chartPoints.length >= 2 ? `<p class="chart-note">Every logged lap at this track &middot; faster sits higher</p>` : ""}
  </div>
</section>`;

  return layout(`${session.track} - ${lapTime(session.lapTimeSeconds)}`, body, navUser, { wide: true });
}

/**
 * The telemetry breakdown: track map, speed trace, pedal traces, and a
 * corner-by-corner table, all sharing one cursor.
 *
 * Everything is drawn from the same distance axis so the map marker and
 * the traces always refer to the same point on track -- that link is the
 * whole value of the page. Reading "you were at 40% throttle" means
 * nothing until you can see where.
 */
function telemetrySection(session: SessionRow, reference: ReferenceRow): string {
  const points = readSamples(session.data);
  const refPoints = reference ? readSamples(reference.data) : [];
  const hasRef = refPoints.length >= 10;

  if (points.length < 10) {
    return `
<section class="panel mt">
  <div class="panel__head"><h2>Telemetry</h2></div>
  <div class="panel__body">
    <div class="empty" style="padding:24px 8px">
      <strong>No telemetry on this lap</strong>
      Only laps driven with a recent version of the app carry it. Drive another
      lap and its breakdown appears here.
    </div>
  </div>
</section>`;
  }

  const hasThrottle = points.some((p) => p.throttle !== null);

  const speeds = points.map((p) => p.speed);
  const maxSpeed = Math.max(...speeds);
  const minSpeed = Math.min(...speeds);
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;

  const braking = points.filter((p) => p.brake > 0.05).length / points.length;
  const onPower = hasThrottle
    ? points.filter((p) => (p.throttle ?? 0) >= 0.95).length / points.length
    : null;
  const coasting = hasThrottle
    ? points.filter((p) => (p.throttle ?? 0) < 0.05 && p.brake <= 0.05).length / points.length
    : null;

  // --- geometry for the map ---
  const located = points.filter((p) => p.x !== null && p.z !== null);
  const xs = located.map((p) => p.x as number);
  const zs = located.map((p) => p.z as number);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const spanX = maxX - minX || 1, spanZ = maxZ - minZ || 1;
  const MAP_W = 460, MAP_H = 340, PAD = 18;
  const mapScale = Math.min((MAP_W - PAD * 2) / spanX, (MAP_H - PAD * 2) / spanZ);
  const offX = (MAP_W - spanX * mapScale) / 2;
  const offY = (MAP_H - spanZ * mapScale) / 2;

  const mapXY = points.map((p) => {
    if (p.x === null || p.z === null) return null;
    return [
      offX + (p.x - minX) * mapScale,
      MAP_H - (offY + (p.z - minZ) * mapScale),
    ] as [number, number];
  });

  // Coloured per segment so braking and throttle read straight off the map.
  const mapSegments = mapXY
    .map((a, i) => {
      const b = mapXY[i + 1];
      if (!a || !b) return "";
      const brake = Math.max(points[i].brake, points[i + 1].brake);
      const t = Math.min(points[i].throttle ?? 0, points[i + 1].throttle ?? 0);
      const colour =
        brake > 0.15 ? "#ff3b3b" : hasThrottle && t >= 0.95 ? "var(--pb)" : "var(--fastest)";
      return `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${colour}" stroke-width="4" stroke-linecap="round"/>`;
    })
    .join("");

  // --- traces share one x axis: distance along the lap ---
  //
  // Both laps are binned every 5m from the start line, so the same
  // distance is the same point on track for either of them. That's what
  // makes overlaying honest: the comparison is position-for-position,
  // not time-for-time, which would drift apart as soon as one driver
  // got ahead.
  const TR_W = 1000, TR_H = 150;
  const lastDistance = points[points.length - 1].distance || 1;
  const tx = (d: number) => (d / lastDistance) * TR_W;

  const refSpeeds = refPoints.map((p) => p.speed);
  const speedFloor = Math.min(minSpeed, ...(hasRef ? refSpeeds : [minSpeed]));
  const speedCeil = Math.max(maxSpeed, ...(hasRef ? refSpeeds : [maxSpeed]));

  function pathFor(source: Point[], value: (p: Point) => number, lo: number, hi: number): string {
    return source
      .map((p, i) => {
        const norm = (value(p) - lo) / (hi - lo || 1);
        const y = TR_H - Math.max(0, Math.min(1, norm)) * (TR_H - 10) - 5;
        return `${i === 0 ? "M" : "L"}${tx(p.distance).toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }

  const speedPath = pathFor(points, (p) => p.speed, speedFloor, speedCeil);
  const brakePath = pathFor(points, (p) => p.brake, 0, 1);
  const throttlePath = hasThrottle ? pathFor(points, (p) => p.throttle ?? 0, 0, 1) : null;

  const refSpeedPath = hasRef ? pathFor(refPoints, (p) => p.speed, speedFloor, speedCeil) : null;
  const refBrakePath = hasRef ? pathFor(refPoints, (p) => p.brake, 0, 1) : null;
  const refHasThrottle = refPoints.some((p) => p.throttle !== null);
  const refThrottlePath = hasRef && refHasThrottle ? pathFor(refPoints, (p) => p.throttle ?? 0, 0, 1) : null;

  // Pedals are near enough binary -- on or off -- so a bare line
  // reduces each application to a couple of vertical pixels. Filling
  // underneath turns them into blocks you can actually see the shape of.
  function areaFor(source: Point[], value: (p: Point) => number): string {
    if (!source.length) return "";
    const top = source
      .map((p, i) => {
        const y = TR_H - Math.max(0, Math.min(1, value(p))) * (TR_H - 10) - 5;
        return `${i === 0 ? "M" : "L"}${tx(p.distance).toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
    const first = tx(source[0].distance).toFixed(1);
    const last = tx(source[source.length - 1].distance).toFixed(1);
    return `${top} L${last} ${TR_H} L${first} ${TR_H} Z`;
  }

  const brakeArea = areaFor(points, (p) => p.brake);
  const throttleArea = hasThrottle ? areaFor(points, (p) => p.throttle ?? 0) : "";

  // Reference sits underneath in every trace, so the driver's own line
  // is never hidden by it -- theirs is the one being read.
  const trace = (
    label: string,
    yours: string | null,
    yoursColour: string,
    ref: string | null,
    area: string = "",
  ) => `
        <div class="trace">
          <span class="trace__label">${label}</span>
          <svg viewBox="0 0 ${TR_W} ${TR_H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            ${area ? `<path d="${area}" fill="${yoursColour}" opacity=".16" stroke="none"/>` : ""}
            ${ref ? `<path d="${ref}" fill="none" stroke="var(--fastest)" stroke-width="2" opacity=".8" vector-effect="non-scaling-stroke"/>` : ""}
            ${yours ? `<path d="${yours}" fill="none" stroke="${yoursColour}" stroke-width="2" vector-effect="non-scaling-stroke"/>` : ""}
            <line class="tel-cursor" y1="0" y2="${TR_H}" stroke="var(--text)" stroke-width="1" opacity=".55" style="display:none"/>
          </svg>
        </div>`;

  // --- corner table ---
  const apexes = findApexes(points);
  const cornerRows = apexes
    .map((i, n) => {
      const p = points[i];
      return `
      <tr class="is-link" data-index="${i}">
        <td class="num pos">${n + 1}</td>
        <td class="num">${p.distance.toFixed(0)}m</td>
        <td class="num col-r laptime">${p.speed.toFixed(0)}</td>
        <td class="num col-r">${p.gear === 0 ? "N" : p.gear < 0 ? "R" : p.gear}</td>
      </tr>`;
    })
    .join("");

  // Only what the cursor needs -- the full sample set would be several
  // hundred KB of page weight for values nothing reads.
  const cursorData = points.map((p) => ({
    d: Math.round(p.distance),
    s: Math.round(p.speed),
    b: Math.round(p.brake * 100),
    t: p.throttle === null ? null : Math.round(p.throttle * 100),
    g: p.gear,
    x: mapXY[points.indexOf(p)]?.[0] ?? null,
    y: mapXY[points.indexOf(p)]?.[1] ?? null,
  }));

  return `
<section class="panel mt">
  <div class="panel__head">
    <h2>Telemetry</h2>
    <span class="tag">${hasRef && reference ? `vs ${escapeHtml(reference.label)} ${escapeHtml(lapTime(reference.lapTimeSeconds))}` : "Hover the traces or click the map"}</span>
  </div>

  <div class="panel__body">
    <div class="stats" style="margin-bottom:18px">
      <div class="stat">
        <div class="stat__k">Top speed</div>
        <div class="stat__v">${maxSpeed.toFixed(0)}<span style="font-size:15px;color:var(--dim)"> kph</span></div>
        <div class="stat__sub">Slowest ${minSpeed.toFixed(0)} &middot; average ${avgSpeed.toFixed(0)}</div>
      </div>
      <div class="stat">
        <div class="stat__k">On the power</div>
        <div class="stat__v ${onPower === null ? "" : "t-pb"}">${onPower === null ? "&mdash;" : pct(onPower)}</div>
        <div class="stat__sub">${onPower === null ? "Not recorded on this lap" : "Full throttle"}</div>
      </div>
      <div class="stat">
        <div class="stat__k">Coasting</div>
        <div class="stat__v ${coasting !== null && coasting > 0.12 ? "t-slow" : ""}">${coasting === null ? "&mdash;" : pct(coasting)}</div>
        <div class="stat__sub">${coasting === null ? "Needs throttle data" : "Neither pedal &middot; lower is quicker"}</div>
      </div>
      <div class="stat">
        <div class="stat__k">Braking</div>
        <div class="stat__v">${pct(braking)}</div>
        <div class="stat__sub">Of the lap</div>
      </div>
    </div>

    <div class="telemetry" id="tel">
      <div class="telemetry__map">
        <svg viewBox="0 0 ${MAP_W} ${MAP_H}" xmlns="http://www.w3.org/2000/svg">
          ${mapSegments}
          <circle id="tel-marker" r="6" fill="#fff" stroke="var(--carbon)" stroke-width="2" style="display:none"/>
        </svg>
        <div class="legend" style="margin-top:10px">
          <span><i style="background:var(--pb)"></i>Full throttle</span>
          <span><i style="background:var(--fastest)"></i>Partial</span>
          <span><i style="background:#ff3b3b"></i>Braking</span>
        </div>
      </div>

      <div class="telemetry__traces">
        <div class="telemetry__readout" id="tel-readout">
          <span><b id="ro-d">&mdash;</b> m</span>
          <span><b id="ro-s">&mdash;</b> kph</span>
          <span>gear <b id="ro-g">&mdash;</b></span>
          <span>thr <b id="ro-t">&mdash;</b>%</span>
          <span>brk <b id="ro-b">&mdash;</b>%</span>
          <span style="margin-left:auto">
            <button type="button" class="linkbtn" id="tel-reset">Reset zoom</button>
          </span>
        </div>
        <p class="hint" style="margin:0 0 10px">Scroll to zoom into a section, drag to move along the lap.</p>

        ${trace("Speed", speedPath, "var(--pb)", refSpeedPath)}
        ${trace("Brake", brakePath, "#ff3b3b", refBrakePath, brakeArea)}
        ${throttlePath ? trace("Throttle", throttlePath, "#ff3b3b", refThrottlePath, throttleArea) : ""}

        <div class="legend" style="margin-top:2px">
          <span><i style="background:var(--pb)"></i>Your speed</span>
          <span><i style="background:#ff3b3b"></i>Your pedals</span>
          ${hasRef ? `<span><i style="background:var(--fastest)"></i>Reference</span>` : ""}
        </div>
        ${hasThrottle ? "" : `<p class="hint">This lap has no throttle trace -- it was driven before the app recorded it.</p>`}
        ${hasRef ? "" : `<p class="hint">Nothing published for this track and class yet, so there's no reference to compare against.</p>`}
    </div>
  </div>

  <div class="panel__head" style="border-top:1px solid var(--line-soft)">
    <h2>Corners</h2><span class="tag">${apexes.length} found</span>
  </div>
  <table class="tower">
    <thead>
      <tr><th class="pos">#</th><th>Distance</th><th class="col-r">Min speed</th><th class="col-r">Gear</th></tr>
    </thead>
    <tbody>${cornerRows}</tbody>
  </table>
  <div class="panel__body" style="border-top:1px solid var(--line-soft)">
    <p class="hint">Corners are the slowest point of each braking-and-turning phase, found from the speed trace. Click a row to jump the cursor there.</p>
  </div>
</section>

<style>
.telemetry{display:grid;grid-template-columns:360px 1fr;gap:22px;align-items:start}
.telemetry__map svg{width:100%;height:auto;display:block;background:var(--carbon);border:1px solid var(--line);border-radius:var(--r-sm)}
.telemetry__traces{min-width:0}
.telemetry__readout{
  display:flex;flex-wrap:wrap;gap:18px;font-family:'IBM Plex Mono',monospace;
  font-size:12.5px;color:var(--dim);margin-bottom:10px;
}
.telemetry__readout b{color:var(--text);font-weight:500}
.trace{margin-bottom:14px}
.trace__label{
  display:block;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.13em;
  text-transform:uppercase;color:var(--dim);margin-bottom:5px;
}
.trace svg{width:100%;height:160px;display:block;background:var(--carbon);border:1px solid var(--line);border-radius:var(--r-sm);cursor:crosshair;touch-action:none}
@media (max-width:900px){.telemetry{grid-template-columns:1fr}}
</style>

<script>
(function(){
  var data = ${JSON.stringify(cursorData)};
  if (!data.length) return;

  var W = ${TR_W}, H = ${TR_H};
  var marker = document.getElementById('tel-marker');
  var cursors = document.querySelectorAll('.tel-cursor');
  var traces = document.querySelectorAll('.trace svg');

  // A lap is over a thousand samples wide; at full zoom a braking zone
  // is a couple of pixels. Zooming is done by moving the SVG viewBox
  // rather than redrawing paths, so it stays smooth however long the
  // lap is, and all three traces share one view so they stay aligned.
  var view = { x0: 0, w: W };

  function applyView(){
    for (var i = 0; i < traces.length; i++){
      traces[i].setAttribute('viewBox', view.x0 + ' 0 ' + view.w + ' ' + H);
    }
  }

  function show(i){
    var p = data[i];
    if (!p) return;
    document.getElementById('ro-d').textContent = p.d;
    document.getElementById('ro-s').textContent = p.s;
    document.getElementById('ro-g').textContent = p.g === 0 ? 'N' : (p.g < 0 ? 'R' : p.g);
    document.getElementById('ro-t').textContent = p.t === null ? '--' : p.t;
    document.getElementById('ro-b').textContent = p.b;
    if (p.x !== null && marker){
      marker.setAttribute('cx', p.x);
      marker.setAttribute('cy', p.y);
      marker.style.display = '';
    }
    var x = (i / (data.length - 1)) * W;
    for (var c = 0; c < cursors.length; c++){
      cursors[c].setAttribute('x1', x);
      cursors[c].setAttribute('x2', x);
      cursors[c].style.display = '';
    }
  }

  function indexAt(svg, clientX){
    var rect = svg.getBoundingClientRect();
    var frac = (clientX - rect.left) / rect.width;
    var chartX = view.x0 + frac * view.w;      // account for the zoom
    var idx = Math.round((chartX / W) * (data.length - 1));
    return Math.max(0, Math.min(data.length - 1, idx));
  }

  var dragging = false, dragFrom = 0, moved = false;

  for (var t = 0; t < traces.length; t++){
    (function(svg){
      svg.addEventListener('wheel', function(e){
        e.preventDefault();
        var rect = svg.getBoundingClientRect();
        var frac = (e.clientX - rect.left) / rect.width;
        var anchor = view.x0 + frac * view.w;   // keep the point under the cursor still
        var next = view.w * (e.deltaY < 0 ? 0.8 : 1.25);
        next = Math.max(30, Math.min(W, next));
        view.x0 = Math.max(0, Math.min(W - next, anchor - frac * next));
        view.w = next;
        applyView();
      }, { passive: false });

      svg.addEventListener('mousedown', function(e){
        dragging = true; moved = false; dragFrom = e.clientX;
      });

      svg.addEventListener('mousemove', function(e){
        if (dragging){
          var rect = svg.getBoundingClientRect();
          var dx = (e.clientX - dragFrom) / rect.width * view.w;
          if (Math.abs(dx) > 0.5) moved = true;
          view.x0 = Math.max(0, Math.min(W - view.w, view.x0 - dx));
          dragFrom = e.clientX;
          applyView();
        } else {
          show(indexAt(svg, e.clientX));
        }
      });
    })(traces[t]);
  }

  window.addEventListener('mouseup', function(){ dragging = false; });

  var reset = document.getElementById('tel-reset');
  if (reset) reset.addEventListener('click', function(){
    view.x0 = 0; view.w = W; applyView();
  });

  // Clicking the map picks the nearest recorded point to the click,
  // which is what people expect from a map even though the underlying
  // axis is distance along the lap rather than screen position.
  var mapSvg = document.querySelector('.telemetry__map svg');
  if (mapSvg){
    mapSvg.style.cursor = 'crosshair';
    mapSvg.addEventListener('click', function(e){
      var rect = mapSvg.getBoundingClientRect();
      var sx = (e.clientX - rect.left) / rect.width * ${MAP_W};
      var sy = (e.clientY - rect.top) / rect.height * ${MAP_H};
      var best = -1, bestD = Infinity;
      for (var i = 0; i < data.length; i++){
        if (data[i].x === null) continue;
        var dx = data[i].x - sx, dy = data[i].y - sy;
        var d2 = dx*dx + dy*dy;
        if (d2 < bestD){ bestD = d2; best = i; }
      }
      if (best >= 0) show(best);
    });
  }

  document.querySelectorAll('tr[data-index]').forEach(function(row){
    row.style.cursor = 'pointer';
    row.addEventListener('click', function(){
      var i = Number(row.getAttribute('data-index'));
      // Zoom to the corner rather than just moving the cursor -- the
      // reason to click a corner is to look at it closely.
      var centre = (i / (data.length - 1)) * W;
      view.w = Math.max(30, W / 8);
      view.x0 = Math.max(0, Math.min(W - view.w, centre - view.w / 2));
      applyView();
      show(i);
    });
  });

  applyView();
  show(0);
})();
</script>`;
}

function sectorNote(value: number | null, all: Array<number | null>): string {
  const valid = all.filter((v): v is number => v !== null && v !== undefined && isFinite(v));
  if (value === null || value === undefined || valid.length === 0) return "No data";
  const best = Math.min(...valid);
  if (value <= best) return "Your best here";
  return `${delta(value - best)} off your best`;
}