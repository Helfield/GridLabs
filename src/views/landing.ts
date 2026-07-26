import { layout, escapeHtml } from "./layout";
import { deltaTraceDiagram } from "./components";

export function landingPage(inviteUrl: string): string {
  const body = `
<section class="hero">
  <div class="rise">
    <span class="eyebrow">Le Mans Ultimate</span>
    <h1>You already know<br>you're <em>slow here</em>.<br>Now find out why.</h1>
    <p class="lede">
      Grid Labs reads your telemetry as you drive and compares it, corner by corner,
      against a reference lap — yours or one a quicker driver recorded. Braking points,
      racing line, gear choice, where the grip ran out.
    </p>
    ${deltaTraceDiagram()}
  </div>

  <div class="card-signup rise rise-2" id="join">
    <h2>Get access</h2>
    <p class="card-signup__sub">Free for members of the Grid Labs Discord.</p>
    <form action="/auth/discord/login" method="get">
      <label class="field">
        <span class="field__label">Name</span>
        <input name="name" required autocomplete="name" placeholder="How you're known on track">
      </label>
      <label class="field">
        <span class="field__label">Email</span>
        <input name="email" type="email" required autocomplete="email" placeholder="you@example.com">
      </label>
      <button class="btn btn--discord" type="submit">Continue with Discord</button>
    </form>
    <p class="card-signup__fine">
      We check your Discord for server membership — nothing gets posted on your behalf.<br>
      Not in yet? <a href="${escapeHtml(inviteUrl)}">Join the Discord</a> first.
    </p>
  </div>
</section>

<div class="rule"></div>

<section class="rise rise-3">
  <span class="eyebrow eyebrow--muted">How it works</span>
  <div class="how mt">
    <div class="how__step">
      <div class="how__n">01</div>
      <h3>Record a reference</h3>
      <p>
        Drive a clean lap with the app running and it saves the whole thing — line, braking,
        gears, sector times. Send that file to anyone, or use a quicker driver's.
      </p>
    </div>
    <div class="how__step">
      <div class="how__n">02</div>
      <h3>Drive against it</h3>
      <p>
        A second screen shows the track ahead of you, rotating as you turn, with braking
        zones marked and your line drawn live against the reference.
      </p>
    </div>
    <div class="how__step">
      <div class="how__n">03</div>
      <h3>See where it went</h3>
      <p>
        Every lap lands here afterwards. Sector by sector, session by session, so you can
        tell a good day from a fast one.
      </p>
    </div>
  </div>
</section>`;

  return layout("Coaching for Le Mans Ultimate", body);
}

export function notInDiscordPage(inviteUrl: string): string {
  const body = `
<div style="max-width:440px;margin:64px auto 0">
  <div class="panel" style="padding:30px;text-align:center">
    <span class="eyebrow" style="text-align:center">Access check</span>
    <h1 style="font-size:32px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:10px">Not in the Discord yet</h1>
    <p class="lede" style="font-size:15px;margin:0 auto 22px">
      Grid Labs is open to members of our Discord server. Join, then come back and sign up
      with the same account.
    </p>
    <a class="btn btn--discord" href="${escapeHtml(inviteUrl)}">Join the Discord</a>
    <p class="card-signup__fine"><a href="/">Back to the start</a></p>
  </div>
</div>`;

  return layout("Join the Discord", body);
}
