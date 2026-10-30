import { layout } from "./layout";

const CONTACT = "brentonnyans78@gmail.com";

export function privacyPage(): string {
  const body = `
<div style="max-width:720px;margin:8px auto 40px">
  <span class="eyebrow">Grid Labs</span>
  <h1 style="font-size:30px;text-transform:uppercase;letter-spacing:.03em;margin:6px 0 4px">Privacy policy</h1>
  <p class="card-signup__fine" style="margin:0 0 24px">Last updated: 29 October 2026</p>

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
    <li>Voice engineer is off until you switch strategy conversations on in the desktop app. When on, a recording you make with the push-to-talk button is sent to the Grid Labs server and then to OpenAI to be turned into words. Our server does not store that audio and we keep no copy of it. The words, current car readings and up to four recent question-and-answer exchanges are then sent to OpenAI for an answer. Readings we can get from the car directly, such as fuel and tyre temperatures, are answered on your PC from those words and never reach OpenAI. With strategy conversations switched off, no recording leaves your PC and only the fixed phrase list is recognised.</li>
  </ul>

  <h3 style="margin-top:26px">Why</h3>
  <p style="color:var(--muted);line-height:1.7">
    Only to run the service: to sign you in, show you and your coach your lap data, build the
    leaderboards and league standings, and, if you opt in, put races on your calendar or answer
    strategy questions. We don't sell your data or use it for advertising.
  </p>

  <h3 style="margin-top:26px">Who sees it</h3>
  <p style="color:var(--muted);line-height:1.7">
    Your laps and league entries are visible to other signed-in members of the Grid Labs community
    on the leaderboards and standings. Account details are visible only to you and to the site's
    coaches/administrators. OpenAI receives the strategy text and car readings described above;
    Grid Labs does not include your account ID, access key, Discord details or recording in those
    requests. Avoid speaking personal information in strategy questions.
  </p>

  <h3 style="margin-top:26px">Storage &amp; retention</h3>
  <p style="color:var(--muted);line-height:1.7">
    Data is held in a PostgreSQL database hosted on Railway. It's kept while your account exists.
    Google's OAuth tokens are stored to perform the calendar actions above and are removed when you
    disconnect the calendar. For strategy conversations, Grid Labs stores a per-account count of
    questions used, not the question text or replies. Recent exchanges are kept in desktop memory and cleared
    when the track, car, session or signed-in account changes, or when strategy conversations are
    switched off. OpenAI's own processing and retention terms apply to requests sent to its API.
  </p>

  <h3 style="margin-top:26px">Your choices</h3>
  <p style="color:var(--muted);line-height:1.7">
    You can disconnect Google Calendar at any time from the league page. Strategy conversations
    can be switched off from Voice engineer in the desktop app without switching off offline
    readings. To delete your account and all associated data, or to ask what we hold about you,
    email us.
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
