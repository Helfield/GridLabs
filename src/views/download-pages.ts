import { layout, escapeHtml, type NavUser } from "./layout";

type Nav = NonNullable<NavUser>;

/**
 * The download page.
 *
 * Exists mainly so the app is never handed out as a Discord attachment:
 * Discord shows a "this file may be harmful" banner on every executable
 * regardless of what it is, and no amount of signing or repackaging
 * removes it -- it's keyed off the file type. A link out to a real
 * download page sidesteps that entirely, and gives the setup steps
 * somewhere to live instead of being repeated in chat.
 *
 * The three things below are in the order they'll be hit, and the
 * Windows warning is called out BEFORE it appears rather than after --
 * a warning you were told to expect reads as a formality; the same
 * warning unannounced reads as "this software is dodgy".
 */
export function downloadPage(navUser: Nav, downloadUrl: string | null): string {
  const button = downloadUrl
    ? `<a class="btn btn--discord" style="background:var(--fastest);max-width:340px" href="${escapeHtml(downloadUrl)}">Download GridLabs for Windows</a>`
    : `<div class="empty"><strong>No build published yet</strong>Set DOWNLOAD_URL and the button appears here.</div>`;

  const body = `
<div class="phead">
  <div>
    <span class="eyebrow">Get the app</span>
    <h1>Download</h1>
    <p class="phead__sub">The desktop app reads your telemetry while you drive and coaches you against a reference lap.</p>
  </div>
</div>

<div class="grid-2">
  <div class="stack">
    <section class="panel">
      <div class="panel__head"><h2>1. Get the app</h2><span class="tag">Windows</span></div>
      <div class="panel__body">
        ${button}
        <p class="hint">One file, nothing to install. Python and everything else is inside it.</p>
      </div>
    </section>

    <section class="panel">
      <div class="panel__head"><h2>2. Windows will warn you</h2></div>
      <div class="panel__body">
        <p style="color:var(--muted);font-size:14.5px;line-height:1.65">
          The first time you run it you'll see <strong>"Windows protected your PC"</strong>.
          Click <strong>More info</strong>, then <strong>Run anyway</strong>.
        </p>
        <p class="hint">
          That warning appears for any app Windows hasn't seen before. It isn't a
          virus scan result and it doesn't mean anything was found. It goes away
          on its own once enough people have run the same build.
        </p>
      </div>
    </section>
  </div>

  <div class="stack">
    <section class="panel">
      <div class="panel__head"><h2>3. One-time setup in LMU</h2><span class="tag">Required</span></div>
      <div class="panel__body">
        <p style="color:var(--muted);font-size:14.5px;line-height:1.65">
          Le Mans Ultimate doesn't share telemetry until you add the shared memory
          plugin. Without it the app connects but never sees anything.
        </p>
        <ol style="color:var(--muted);font-size:14px;line-height:1.8;padding-left:20px;margin-top:12px">
          <li>Download <span class="mono">rFactor2SharedMemoryMapPlugin64.dll</span></li>
          <li>Put it in <span class="mono">&lt;Le Mans Ultimate&gt;\\Bin64\\Plugins\\</span></li>
          <li>In LMU: <strong>Settings &rarr; Gameplay &rarr; Plugins</strong>, enable it</li>
          <li>Restart LMU</li>
        </ol>
      </div>
    </section>

    <section class="panel">
      <div class="panel__head"><h2>4. Sign in</h2></div>
      <div class="panel__body">
        <p style="color:var(--muted);font-size:14.5px;line-height:1.65">
          On first run the app asks for an access key. Copy yours from your
          <a href="/account" style="color:var(--fastest)">account page</a>.
        </p>
        <p class="hint">
          You can skip it and use the app offline -- laps still save on your PC,
          they just won't sync here or show up in your history.
        </p>
      </div>
    </section>
  </div>
</div>`;
  return layout("Download", body, navUser);
}