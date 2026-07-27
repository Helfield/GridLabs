/**
 * layout.ts
 *
 * The page shell and the whole design system.
 *
 * Direction: a race engineer's pit-wall screen, not a driver's HUD. The
 * palette is taken from motorsport timing convention, where the colours
 * already carry meaning rather than decoration:
 *   purple = fastest    green = personal best    amber = slower
 * That's why purple is the primary accent -- in this world it literally
 * means "fastest", which is the whole point of the product.
 *
 * Type has three jobs: Barlow Condensed for signage-style headings,
 * IBM Plex Sans for reading, IBM Plex Mono (tabular figures) for every
 * number, so timing columns align the way a real timing tower does.
 *
 * Plain CSS rather than a utility framework: no build step for the
 * person running this, no CDN dependency, and precise control over the
 * type scale and timing-tower alignment.
 */

export type NavUser = {
  name: string;
  role: string;
  discordAvatarUrl: string | null;
} | null;

export function layout(
  title: string,
  bodyHtml: string,
  user: NavUser = null,
  options: { wide?: boolean; bare?: boolean } = {},
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · GridLabs</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;450;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
${options.bare ? "" : navBar(user)}
<main class="shell${options.wide ? " shell--wide" : ""}">
${bodyHtml}
</main>
${options.bare ? "" : footer()}
</body>
</html>`;
}

function navBar(user: NavUser): string {
  if (!user) {
    return `
<header class="nav">
  <div class="nav__inner">
    <a class="mark" href="/">
      <span class="mark__bars" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="mark__text">GridLabs</span>
    </a>
    <a class="btn btn--ghost btn--sm" href="/#join">Sign in</a>
  </div>
</header>`;
  }

  const avatar = user.discordAvatarUrl
    ? `<img class="avatar" src="${escapeHtml(user.discordAvatarUrl)}" alt="">`
    : `<span class="avatar avatar--fallback">${escapeHtml((user.name[0] ?? "?").toUpperCase())}</span>`;

  const home = user.role === "coach" ? "/coach" : "/student";
  const homeLabel = user.role === "coach" ? "Drivers" : "My driving";

  return `
<header class="nav">
  <div class="nav__inner">
    <div class="nav__left">
      <a class="mark" href="${home}">
        <span class="mark__bars" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="mark__text">GridLabs</span>
      </a>
      <nav class="nav__links">
        <a href="${home}">${homeLabel}</a>
        <a href="/library">Reference Laps</a>
        <a href="/download">Download</a>
        ${user.role === "coach" ? `<a href="/coach/reference-laps">Upload</a>` : ""}
        <a href="/account">Account</a>
      </nav>
    </div>
    <div class="nav__right">
      ${avatar}
      <span class="nav__name">${escapeHtml(user.name)}</span>
      <span class="tag">${escapeHtml(user.role)}</span>
      <form action="/auth/logout" method="post"><button class="linkbtn" type="submit">Sign out</button></form>
    </div>
  </div>
</header>`;
}

function footer(): string {
  return `
<footer class="foot">
  <div class="foot__inner">
    <span>GridLabs · Le Mans Ultimate coaching</span>
    <span class="foot__note">Members only</span>
  </div>
</footer>`;
}

export function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
:root{
  --carbon:#0B0E14;
  --panel:#131822;
  --panel-2:#1A2130;
  --line:#242C3A;
  --line-soft:#1B2230;
  --text:#E8ECF4;
  --muted:#8492A6;
  --dim:#5D6A7D;
  --fastest:#B14BFF;
  --pb:#22D07E;
  --warn:#FFB020;
  --discord:#5865F2;
  --shell:1180px;
  --r:14px;
  --r-sm:9px;
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--carbon);color:var(--text);
  font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  font-size:15px;line-height:1.55;font-weight:400;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;min-height:100vh;
}
/* Faint grid, like a data plot behind the pit-wall screen. */
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background-image:linear-gradient(var(--line-soft) 1px,transparent 1px),
                   linear-gradient(90deg,var(--line-soft) 1px,transparent 1px);
  background-size:64px 64px;
  mask-image:radial-gradient(ellipse 90% 60% at 50% 0%,#000 0%,transparent 75%);
  opacity:.5;
}
main,header,footer{position:relative;z-index:1}
a{color:inherit}
h1,h2,h3{margin:0;font-family:'Barlow Condensed',sans-serif;font-weight:600;line-height:1.05;letter-spacing:.01em}
p{margin:0}

.shell{width:100%;max-width:var(--shell);margin:0 auto;padding:34px 24px 72px;flex:1}
.shell--wide{max-width:1320px}

/* ---------- nav ---------- */
.nav{border-bottom:1px solid var(--line);background:rgba(11,14,20,.82);backdrop-filter:blur(10px);position:sticky;top:0}
.nav__inner{max-width:var(--shell);margin:0 auto;padding:0 24px;height:58px;display:flex;align-items:center;justify-content:space-between;gap:20px}
.nav__left{display:flex;align-items:center;gap:28px;min-width:0}
.nav__links{display:flex;gap:20px}
.nav__links a{
  font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.09em;
  font-size:14px;font-weight:600;color:var(--muted);text-decoration:none;padding:4px 0;
  border-bottom:2px solid transparent;transition:color .15s,border-color .15s;
}
.nav__links a:hover{color:var(--text);border-bottom-color:var(--fastest)}
.nav__right{display:flex;align-items:center;gap:11px}
.nav__name{font-size:13.5px;color:var(--muted);white-space:nowrap}
.mark{display:flex;align-items:center;gap:9px;text-decoration:none;flex-shrink:0}
.mark__bars{display:flex;gap:2.5px;align-items:flex-end;height:17px}
.mark__bars i{width:3.5px;background:var(--fastest);border-radius:1px;display:block}
.mark__bars i:nth-child(1){height:9px;opacity:.45}
.mark__bars i:nth-child(2){height:13px;opacity:.72}
.mark__bars i:nth-child(3){height:17px}
.mark__text{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:19px;letter-spacing:.045em;text-transform:uppercase}
.avatar{width:27px;height:27px;border-radius:50%;border:1px solid var(--line);object-fit:cover}
.avatar--fallback{display:grid;place-items:center;background:var(--panel-2);font-size:12px;color:var(--muted)}
.linkbtn{background:none;border:0;color:var(--dim);font:inherit;font-size:13.5px;cursor:pointer;padding:0}
.linkbtn:hover{color:var(--warn)}

.tag{
  font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:500;text-transform:uppercase;
  letter-spacing:.11em;color:var(--muted);border:1px solid var(--line);
  padding:2.5px 7px;border-radius:4px;white-space:nowrap;
}

/* ---------- shared bits ---------- */
.eyebrow{
  font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:500;text-transform:uppercase;
  letter-spacing:.18em;color:var(--fastest);margin-bottom:14px;display:block;
}
.eyebrow--muted{color:var(--dim)}
.lede{color:var(--muted);font-size:16.5px;line-height:1.6;max-width:56ch}
.mono{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}

.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--r)}
.panel__head{
  display:flex;align-items:baseline;justify-content:space-between;gap:14px;
  padding:16px 20px 13px;border-bottom:1px solid var(--line-soft);
}
.panel__head h2{font-size:19px;text-transform:uppercase;letter-spacing:.06em}
.panel__body{padding:18px 20px}

.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:9px;
  font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:16px;
  text-transform:uppercase;letter-spacing:.07em;
  padding:12px 22px;border-radius:var(--r-sm);border:1px solid transparent;
  text-decoration:none;cursor:pointer;transition:transform .12s,background .15s,border-color .15s;
}
.btn:active{transform:translateY(1px)}
.btn--discord{background:var(--discord);color:#fff;width:100%}
.btn--discord:hover{background:#4a56d6}
.btn--ghost{background:transparent;border-color:var(--line);color:var(--text)}
.btn--ghost:hover{border-color:var(--fastest);color:#fff}
.btn--sm{padding:8px 15px;font-size:14px}

.field{display:block;margin-bottom:14px}
.field__label{
  display:block;font-family:'IBM Plex Mono',monospace;font-size:10.5px;text-transform:uppercase;
  letter-spacing:.13em;color:var(--muted);margin-bottom:7px;
}
.field input{
  width:100%;background:var(--carbon);border:1px solid var(--line);border-radius:var(--r-sm);
  padding:11px 13px;color:var(--text);font:inherit;font-size:14.5px;
}
.field input:focus{outline:none;border-color:var(--fastest);box-shadow:0 0 0 3px rgba(177,75,255,.15)}

.empty{text-align:center;padding:38px 20px;color:var(--dim);font-size:14px}
.empty strong{display:block;color:var(--muted);font-weight:500;margin-bottom:5px}

/* ---------- timing tower ---------- */
.tower{width:100%;border-collapse:collapse}
.tower th{
  font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:500;text-transform:uppercase;
  letter-spacing:.13em;color:var(--dim);text-align:left;
  padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap;
}
.tower td{padding:13px 14px;border-bottom:1px solid var(--line-soft);font-size:14px;vertical-align:middle}
.tower tr:last-child td{border-bottom:0}
.tower tbody tr{transition:background .12s}
.tower tbody tr.is-link{cursor:pointer}
.tower tbody tr.is-link:hover{background:var(--panel-2)}
.tower .num{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
.tower .col-r{text-align:right}
.tower .pos{color:var(--dim);width:34px}
.tower .laptime{font-size:16px;font-weight:500;letter-spacing:-.01em}
.tower .chev{color:var(--dim);width:22px;text-align:right}
.tower tbody tr.is-link:hover .chev{color:var(--fastest)}

/* Timing colours are data, not decoration:
   purple = your fastest, green = better than your average, plain = slower. */
.t-fastest{color:var(--fastest)}
.t-pb{color:var(--pb)}
.t-slow{color:var(--muted)}
.t-none{color:var(--dim)}

.legend{display:flex;flex-wrap:wrap;gap:16px;align-items:center}
.legend span{display:inline-flex;align-items:center;gap:6px;font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.legend i{width:8px;height:8px;border-radius:2px;display:block}

/* ---------- stat strip ---------- */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.stat{background:var(--panel);padding:17px 20px}
.stat__k{font-family:'IBM Plex Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:var(--dim);margin-bottom:8px}
.stat__v{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;font-size:27px;font-weight:500;line-height:1;letter-spacing:-.02em}
.stat__sub{font-size:12.5px;color:var(--dim);margin-top:6px}

/* ---------- page header ---------- */
.phead{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:24px}
.phead h1{font-size:clamp(30px,4vw,42px);text-transform:uppercase;letter-spacing:.02em}
.phead__sub{color:var(--muted);font-size:14.5px;margin-top:6px}
.backlink{
  display:inline-flex;align-items:center;gap:7px;font-family:'IBM Plex Mono',monospace;
  font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);
  text-decoration:none;margin-bottom:18px;
}
.backlink:hover{color:var(--fastest)}

.grid-2{display:grid;grid-template-columns:1.55fr .95fr;gap:22px;align-items:start}
.stack{display:flex;flex-direction:column;gap:22px}
.mt{margin-top:22px}

/* ---------- driver row (coach list) ---------- */
.driver{display:flex;align-items:center;gap:11px;min-width:0}
.driver__name{font-weight:500}
.driver__handle{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--dim)}

/* ---------- reference lap list ---------- */
.reflist{display:flex;flex-direction:column}
.ref{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 0;border-top:1px solid var(--line-soft)}
.ref:first-child{border-top:0;padding-top:2px}
.ref__label{font-weight:500;font-size:14px}
.ref__meta{font-family:'IBM Plex Mono',monospace;font-size:11.5px;color:var(--dim);margin-top:3px}
.ref__time{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;font-size:14.5px;color:var(--muted);white-space:nowrap}

/* ---------- chart ---------- */
.chart{width:100%;height:auto;display:block;overflow:visible}
.chart-note{font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin-top:12px}

/* ---------- landing ---------- */
.hero{display:grid;grid-template-columns:1.15fr .85fr;gap:52px;align-items:center;padding:56px 0 44px}
.hero h1{font-size:clamp(42px,7vw,76px);text-transform:uppercase;letter-spacing:.005em;line-height:.94}
.hero h1 em{font-style:normal;color:var(--fastest)}
.hero .lede{margin-top:20px}
.trace{margin-top:38px}
.card-signup{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:26px}
.card-signup h2{font-size:23px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.card-signup__sub{color:var(--muted);font-size:13.5px;margin-bottom:20px}
.card-signup__fine{font-size:12.5px;color:var(--dim);margin-top:15px;text-align:center;line-height:1.5}
.card-signup__fine a{color:var(--muted)}

.rule{height:1px;background:var(--line);margin:12px 0 44px}
.how{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.how__step{background:var(--panel);padding:24px 22px 26px}
.how__n{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;color:var(--fastest);margin-bottom:12px}
.how__step h3{font-size:20px;text-transform:uppercase;letter-spacing:.045em;margin-bottom:9px}
.how__step p{color:var(--muted);font-size:14px;line-height:1.6}

.foot{border-top:1px solid var(--line);margin-top:auto}
.foot__inner{
  max-width:var(--shell);margin:0 auto;padding:20px 24px;display:flex;justify-content:space-between;gap:14px;
  font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);
}

/* ---------- token box ---------- */
.token{
  font-family:'IBM Plex Mono',monospace;font-size:13px;word-break:break-all;
  background:var(--carbon);border:1px solid var(--line);border-radius:var(--r-sm);
  padding:14px;color:var(--text);user-select:all;line-height:1.6;
}
.hint{color:var(--dim);font-size:12.5px;margin-top:11px;line-height:1.55}

/* ---------- motion + responsive ---------- */
@keyframes drawA{from{stroke-dashoffset:2600}to{stroke-dashoffset:0}}
@keyframes drawB{from{stroke-dashoffset:1400}to{stroke-dashoffset:0}}
@keyframes rise{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
.rise{animation:rise .5s cubic-bezier(.2,.7,.3,1) both}
.rise-2{animation-delay:.08s}
.rise-3{animation-delay:.16s}

@media (max-width:900px){
  .hero{grid-template-columns:1fr;gap:36px;padding:34px 0 30px}
  .grid-2{grid-template-columns:1fr}
  .how{grid-template-columns:1fr}
  .nav__links{display:none}
  .shell{padding:26px 18px 56px}
  .nav__inner,.foot__inner{padding-left:18px;padding-right:18px}
  .hide-sm{display:none}
}
@media (prefers-reduced-motion:reduce){
  *{animation:none!important;transition:none!important}
  .chart path,.trace path{stroke-dashoffset:0!important}
}
:focus-visible{outline:2px solid var(--fastest);outline-offset:2px;border-radius:3px}
`;