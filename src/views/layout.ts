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
 * Type: Race Sport for all of it, and IBM Plex Mono (tabular figures) for
 * lap times and other figures, so timing columns align the way a real
 * timing tower does.
 *
 * Plain CSS rather than a utility framework: no build step for the
 * person running this, no CDN dependency, and precise control over the
 * type scale and timing-tower alignment.
 */

import { siteUrl } from "../siteUrl";

export type NavUser = {
  name: string;
  role: string;
  discordUsername?: string;
  discordAvatarUrl: string | null;
} | null;

// Resolved by siteUrl() (SITE_URL, else the site's own address) -- only used to build
// absolute URLs for og:image/og:url, which social crawlers require
// (relative paths in OG tags are silently ignored by most of them).
const SITE_URL = siteUrl();
const DEFAULT_DESCRIPTION =
  "Telemetry coaching for Le Mans Ultimate. Compare your laps with a reference lap and see where you're losing time.";

const MARK = `<svg class="mark__g" viewBox="-14 0 116 120" aria-hidden="true"><g transform="skewX(-6)"><polygon fill="var(--white)" points="0,0 100,0 100,22 21,22 21,95 48,95 48,120 0,120"/><polygon fill="var(--fastest)" points="40,49 98,49 98,120 48,120 48,95 73,95 73,71 40,71"/></g></svg>`;

/** The three photographs used behind signed-in pages. See the wallpapers block in CSS. */
export type Wallpaper = "asphalt" | "kerb" | "spapark";

export function layout(
  title: string,
  bodyHtml: string,
  user: NavUser = null,
  options: { wide?: boolean; bare?: boolean; description?: string; wallpaper?: Wallpaper } = {},
): string {
  const description = options.description ?? DEFAULT_DESCRIPTION;
  const fullTitle = `${escapeHtml(title)} · GridLabs`;
  const bodyClass = options.wallpaper ? ` class="wp wp-${options.wallpaper}"` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="theme-color" content="#0B0E14">

<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">

<meta property="og:type" content="website">
<meta property="og:site_name" content="GridLabs">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${SITE_URL}">
<meta property="og:image" content="${SITE_URL}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${fullTitle}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${SITE_URL}/og-image.png">

<link rel="preload" href="/fonts/race-sport.ttf" as="font" type="font/ttf" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body${bodyClass}>
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
      ${MARK}
      <span class="mark__text">Grid Labs</span>
    </a>
    <a class="btn btn--ghost btn--sm" href="/auth/discord/login">Log in</a>
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
        ${MARK}
        <span class="mark__text">Grid Labs</span>
      </a>
      <nav class="nav__links">
        <a href="${home}">${homeLabel}</a>
        <a href="/library">Reference laps</a>
        <a href="/download">Download</a>
        <a href="/league">League</a>
        ${user.role === "coach" ? `<a href="/coach/reference-laps">Upload</a><a href="/coach/discord">Discord</a>` : ""}
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
    <span>Grid Labs · Sim racing community and coaching</span>
    <a href="/privacy">Privacy</a>
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
/* The one brand face has a single weight, so the face claims the whole range and the
   browser never fakes a bold. The metric overrides pin the Windows line metrics so text
   sits the same way on Mac and iOS. */
@font-face{
  font-family:'Race Sport';src:url(/fonts/race-sport.ttf) format('truetype');
  font-weight:100 900;font-display:swap;ascent-override:106.1%;descent-override:37.3%;line-gap-override:0%;
  /* Every letter is a wide capital, so at the sizes the layout was set for it overflows fields and labels. */
  size-adjust:88%;
  /* Its ! % & / read as I, °l., 8 and a bar. */
  unicode-range:U+0-20,U+22-24,U+27-2E,U+30-10FFFF;
}
:root{
  --font-display:'Race Sport',system-ui,sans-serif;
  --font-text:'Race Sport',system-ui,sans-serif;
  --carbon:#0B0E14;
  --panel:#131822;
  --panel-2:#1A2130;
  --line:#242C3A;
  --line-soft:#1B2230;
  /* Blocks are told apart by tone and space, not by drawn edges. This is the only separator
     left, and it is for rows inside a table -- a shade, not a line. */
  --hair:rgba(255,255,255,.05);
  --text:#E8ECF4;
  --muted:#8492A6;
  --dim:#5D6A7D;
  --fastest:#A06BFF;
  --white:#F3F4F8;
  --cyan:#38D3E0;
  --pb:#22D07E;
  --warn:#FFB020;
  --discord:#5865F2;
  --shell:1180px;
  --r:16px;
  --r-sm:10px;
}
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:dark;-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--carbon);color:var(--text);
  font-family:var(--font-text);
  font-size:15px;line-height:1.55;font-weight:400;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;min-height:100vh;
}
a{color:inherit}
h1,h2,h3{margin:0;font-weight:700;line-height:1.1}
h1{font-family:var(--font-display)}
p{margin:0}

.shell{width:100%;max-width:var(--shell);margin:0 auto;padding:44px 24px 96px;flex:1}
.shell--wide{max-width:1320px}

/* ---------- wallpapers ----------
   Signed-in pages sit on one of three photographs, held behind a scrim so
   the timing colours keep the meaning they carry. The image is pinned to the
   viewport rather than the document, so a long session tower scrolls over a
   still picture instead of repeating it. Panels go translucent and blurred,
   which is what lets the wallpaper read as a surface the UI is resting on
   rather than a picture behind it.

   On the body's own background, not a z-index:-1 pseudo-element: the landing
   page's hero video already lives at -1, and it only stays visible because
   body's background propagates to the canvas. Give body a competing paint
   order and the video disappears behind it. */
body.wp{
  background:
    linear-gradient(180deg,rgba(11,14,20,.62),rgba(11,14,20,.74) 50%,rgba(11,14,20,.86)),
    var(--wp) center/cover no-repeat fixed;
}
.wp-asphalt{--wp:url("/bg-asphalt.webp")}
.wp-kerb{--wp:url("/bg-kerb.webp")}
.wp-spapark{--wp:url("/bg-spapark.webp")}
body.wp .panel{background:rgba(19,24,34,.46);backdrop-filter:blur(8px) saturate(140%)}
body.wp .stats{background:rgba(19,24,34,.46);backdrop-filter:blur(8px) saturate(140%)}
body.wp .stat{background:transparent}
body.wp .nav{background:rgba(11,14,20,.66)}

/* ---------- nav ---------- */
.nav{background:rgba(11,14,20,.85);backdrop-filter:blur(10px);position:sticky;top:0;z-index:10}
.nav__inner{max-width:var(--shell);margin:0 auto;padding:8px 24px;min-height:58px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.nav__left{display:flex;align-items:center;gap:22px;min-width:0}
/* Whole labels drop to a second row rather than breaking mid-word when the row runs out of room. */
.nav__links{display:flex;flex-wrap:wrap;gap:14px}
.nav__links a{
  font-size:13.5px;font-weight:500;color:var(--muted);text-decoration:none;padding:4px 0;white-space:nowrap;
  border-bottom:2px solid transparent;transition:color .15s,border-color .15s;
}
.nav__links a:hover{color:var(--text);border-bottom-color:var(--fastest)}
.nav__right{display:flex;align-items:center;gap:11px}
.nav__name{font-size:13.5px;color:var(--muted);white-space:nowrap}
.mark{display:flex;align-items:center;gap:10px;text-decoration:none;flex-shrink:0}
.mark__g{width:24px;height:25px;display:block}
.mark__text{font-weight:700;font-size:20px;letter-spacing:.01em;white-space:nowrap}
.avatar{width:27px;height:27px;border-radius:50%;border:1px solid var(--hair);object-fit:cover}
.avatar--fallback{display:grid;place-items:center;background:var(--panel-2);font-size:12px;color:var(--muted)}
.linkbtn{background:none;border:0;color:var(--dim);font:inherit;font-size:13.5px;cursor:pointer;padding:0;white-space:nowrap}
.linkbtn:hover{color:var(--warn)}

.tag{
  display:inline-block;font-family:var(--font-text);font-size:12px;font-weight:500;line-height:1.6;color:var(--muted);
  background:var(--panel-2);padding:1px 10px;border-radius:999px;white-space:nowrap;
}
/* Roles and on/off values arrive lowercase. */
.tag::first-letter{text-transform:uppercase}

/* ---------- shared bits ---------- */
.eyebrow{font-size:13.5px;font-weight:500;color:var(--muted);margin-bottom:6px;display:block}
.eyebrow--muted{color:var(--dim)}
.lede{color:#A3AEBF;font-size:17px;line-height:1.6;max-width:54ch}
.mono{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}

/* A transparent border, not "none": the status panels set border-color inline to carry
   a colour (approved / disqualified / removed), and that only paints if there is a border. */
.panel{background:var(--panel);border:1px solid transparent;border-radius:var(--r)}
.panel__head{
  display:flex;align-items:baseline;justify-content:space-between;gap:14px;
  padding:20px 22px 16px;
}
.panel__head h2{font-size:19px}
.panel__body{padding:18px 22px}
/* The head already leaves room below the heading. */
.panel__head+.panel__body{padding-top:2px}

.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:9px;
  font-family:var(--font-text);font-weight:600;font-size:15px;line-height:1.3;
  padding:11px 20px;border-radius:8px;border:1px solid transparent;
  text-decoration:none;cursor:pointer;transition:transform .12s,background .15s,border-color .15s;
}
.btn:active{transform:translateY(1px)}
.btn--discord{background:var(--discord);color:#fff;width:100%}
.btn--discord:hover{background:#4a56d6}
.btn--ghost{background:var(--panel-2);border-color:transparent;color:var(--text)}
.btn--ghost:hover{background:var(--line);color:#fff}
.btn--sm{padding:7px 14px;font-size:14px}

.field{display:block;margin-bottom:14px}
.field__label{display:block;font-size:13px;font-weight:500;color:#A3AEBF;margin-bottom:6px}
/* Controls are a fill, not a box. panel-2 is lighter than both the page and a panel, so the
   same rule reads as raised wherever it sits. It targets the elements rather than only the
   ones inside a .field, because a bare input otherwise picks up the browser's own grey box. */
input:not([type="checkbox"]):not([type="radio"]),select,textarea{
  background:var(--panel-2);border:1px solid transparent;border-radius:var(--r-sm);
  padding:11px 13px;color:var(--text);font:inherit;font-size:14.5px;color-scheme:dark;
}
.field input,.field select,.field textarea{width:100%;text-overflow:ellipsis}
input:focus:not([type="checkbox"]):not([type="radio"]),select:focus,textarea:focus{
  outline:none;border-color:var(--fastest);box-shadow:0 0 0 3px rgba(160,107,255,.18);
}

.empty{text-align:center;padding:38px 20px;color:var(--dim);font-size:14px}
.empty strong{display:block;color:var(--muted);font-weight:500;margin-bottom:5px}

/* ---------- timing tower ---------- */
.tower{width:100%;border-collapse:collapse}
.tower th{
  font-size:12.5px;font-weight:500;color:var(--dim);text-align:left;
  padding:11px 14px;border-bottom:1px solid var(--hair);white-space:nowrap;
}
.tower td{padding:14px;border-bottom:1px solid var(--hair);font-size:14px;vertical-align:middle}
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
.legend span{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--dim)}
.legend i{width:8px;height:8px;border-radius:2px;display:block}

/* ---------- stat strip ---------- */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0;background:var(--panel);border-radius:var(--r);overflow:hidden}
.stat{background:var(--panel);padding:20px 22px}
.stat__k{font-size:12.5px;font-weight:500;color:var(--dim);margin-bottom:8px}
.stat__v{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;font-size:27px;font-weight:500;line-height:1;letter-spacing:-.02em}
.stat__sub{font-size:12.5px;color:var(--dim);margin-top:6px}

/* ---------- page header ---------- */
.phead{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:36px}
.phead h1{font-size:clamp(30px,4vw,42px)}
.phead__sub{color:var(--muted);font-size:14.5px;margin-top:6px}
.backlink{
  display:inline-flex;align-items:center;gap:7px;font-size:13.5px;color:var(--dim);
  text-decoration:none;margin-bottom:18px;
}
.backlink:hover{color:var(--fastest)}

.grid-2{display:grid;grid-template-columns:1.55fr .95fr;gap:32px;align-items:start}
.stack{display:flex;flex-direction:column;gap:32px}
.mt{margin-top:32px}

/* ---------- driver row (coach list) ---------- */
.driver{display:flex;align-items:center;gap:11px;min-width:0}
.driver__name{font-weight:500}
.driver__handle{font-size:12.5px;color:var(--dim)}

/* ---------- reference lap list ---------- */
.reflist{display:flex;flex-direction:column}
.ref{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-top:1px solid var(--hair)}
.ref:first-child{border-top:0;padding-top:2px}
.ref__label{font-weight:500;font-size:14px}
.ref__meta{font-size:12.5px;color:var(--dim);margin-top:3px}
.ref__time{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;font-size:14.5px;color:var(--muted);white-space:nowrap}

/* ---------- chart ---------- */
.chart{width:100%;height:auto;display:block;overflow:visible}
.chart-note{font-size:13px;color:#6F7C90;margin-top:10px}

/* ---------- landing ---------- */
/* Centred on the sign-up card (350px right of the page centre at full width) so the card hides the tunnel's white core. */
.hero-bg{position:absolute;top:0;left:0;right:0;height:880px;overflow:hidden;z-index:-1;pointer-events:none}
.hero-bg__video{
  position:absolute;left:calc(50% + min(350px,30%));top:365px;transform:translate(-50%,-50%);
  width:clamp(1280px,115%,1800px);height:auto;display:block;opacity:.8;
  -webkit-mask-image:radial-gradient(closest-side,#000 40%,transparent);
  mask-image:radial-gradient(closest-side,#000 40%,transparent);
}
.hero-bg::after{
  content:"";position:absolute;inset:0;
  background:
    linear-gradient(180deg,rgba(11,14,20,0) 60%,var(--carbon) 100%),
    linear-gradient(90deg,rgba(11,14,20,.9) 0,rgba(11,14,20,.78) 40%,rgba(11,14,20,.55) 52%,rgba(11,14,20,.15) 64%);
}
.hero{display:grid;grid-template-columns:1.2fr .8fr;gap:64px;align-items:start;padding:56px 0 96px}
.hero h1{font-size:clamp(40px,5.2vw,60px);line-height:1.08;letter-spacing:-.005em;max-width:15ch;margin-bottom:26px}
.trace{margin-top:38px}
.card-signup{position:relative;overflow:hidden;background:var(--panel);border-radius:var(--r);padding:32px 28px 26px}
.card-signup__livery{position:absolute;top:0;right:0;width:150px;height:66px}
.card-signup h2{font-family:var(--font-display);font-size:26px;margin:2px 0 6px}
.card-signup__sub{color:#8D99AB;font-size:14px;margin-bottom:22px;max-width:30ch}
.card-signup__fine{font-size:13px;color:#6F7C90;margin-top:14px;line-height:1.55}
.card-signup__fine a{color:#B9C2D0;text-decoration:underline;text-underline-offset:2px}

.foot{margin-top:auto}
.foot__inner{
  max-width:var(--shell);margin:0 auto;padding:28px 24px;display:flex;justify-content:space-between;gap:14px;
  font-size:13px;color:#6F7C90;
}
.foot__inner a{color:inherit;text-decoration:none}
.foot__inner a:hover{color:var(--text)}

/* ---------- token box ---------- */
.token{
  font-family:'IBM Plex Mono',monospace;font-size:13px;word-break:break-all;
  background:var(--carbon);border:1px solid transparent;border-radius:var(--r-sm);
  padding:14px;color:var(--text);user-select:all;line-height:1.6;
}
.hint{color:var(--dim);font-size:12.5px;margin-top:11px;line-height:1.55}

/* ---------- motion + responsive ---------- */
@keyframes drawA{from{stroke-dashoffset:2600}to{stroke-dashoffset:0}}

/* The staff role pill is the one nav item nobody needs a second time on every page,
   so it goes before the links have to wrap. */
@media (max-width:1230px){.nav__right .tag{display:none}}
@media (max-width:900px){
  .hero-bg{height:620px}
  .hero-bg__video{left:50%;top:70px;width:max(820px,190%)}
  .hero-bg::after{background:linear-gradient(180deg,rgba(11,14,20,.5) 0,rgba(11,14,20,.8) 35%,var(--carbon) 100%)}
  .hero{grid-template-columns:1fr;gap:36px;padding:10px 0 44px}
  .grid-2{grid-template-columns:1fr}
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