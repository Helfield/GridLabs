import { layout } from "./layout";

const CONTACT = "brentonnyans78@gmail.com";

export function privacyPage(): string {
  const body = `
<div style="max-width:720px;margin:8px auto 40px">
  <span class="eyebrow">Grid Labs</span>
  <h1 style="font-size:30px;text-transform:uppercase;letter-spacing:.03em;margin:6px 0 4px">Privacy policy</h1>
  <p class="card-signup__fine" style="margin:0 0 24px">Last updated: 18 October 2026</p>

  <p class="lede" style="font-size:15px">
    Grid Labs is a coaching and community tool for the racing sim <em>Le Mans Ultimate</em>. This
    page explains what we store and why. We keep it deliberately small.
  </p>

  <h3 style="margin-top:26px">What we collect</h3>
  <ul style="line-height:1.7;color:var(--muted)">
    <li><strong style="color:var(--text)">Discord account</strong> — your Discord ID, username and avatar, used to confirm you're a member of our server and to sign you in. We read your server membership; we never post to Discord on your behalf.</li>
    <li><strong style="color:var(--text)">Driving telemetry</strong> — the lap data your desktop app uploads (track, car, lap and sector times, and the per-corner trace used for the coaching overlay), tied to your account so you can review your own history and appear on the leaderboards.</li>
    <li><strong style="color:var(--text)">League details</strong> — if you register for a league, the team name and safety/driver ratings you choose to enter, shown to other members in that league's entry list and standings.</li>
    <li><strong style="color:var(--text)">Google Calendar (only if you connect it)</strong> — your Google email and a token that lets us add or remove league race events on your calendar. You can disconnect at any time, which deletes the token.</li>
  </ul>

  <h3 style="margin-top:26px">Why</h3>
  <p style="color:var(--muted);line-height:1.7">
    Only to run the service: to sign you in, show you and your coach your lap data, build the
    leaderboards and league standings, and — if you opt in — put races on your calendar. We don't
    sell your data or use it for advertising.
  </p>

  <h3 style="margin-top:26px">Who sees it</h3>
  <p style="color:var(--muted);line-height:1.7">
    Your laps and league entries are visible to other signed-in members of the Grid Labs community
    on the leaderboards and standings. Everything else is visible only to you and to the site's
    coaches/administrators.
  </p>

  <h3 style="margin-top:26px">Storage &amp; retention</h3>
  <p style="color:var(--muted);line-height:1.7">
    Data is held in a PostgreSQL database hosted on Railway. It's kept while your account exists.
    Google's OAuth tokens are stored to perform the calendar actions above and are removed when you
    disconnect the calendar.
  </p>

  <h3 style="margin-top:26px">Your choices</h3>
  <p style="color:var(--muted);line-height:1.7">
    You can disconnect Google Calendar at any time from the league page. To delete your account and
    all associated data, or to ask what we hold about you, email us.
  </p>

  <h3 style="margin-top:26px">Contact</h3>
  <p style="color:var(--muted);line-height:1.7">
    Questions about this policy: <a href="mailto:${CONTACT}">${CONTACT}</a>.
  </p>

  <p class="card-signup__fine" style="margin-top:30px"><a href="/">← Back to Grid Labs</a></p>
</div>`;

  return layout("Privacy policy", body, null, {
    description: "How Grid Labs collects, uses and stores your data.",
  });
}
