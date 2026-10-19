import { layout, escapeHtml } from "./layout";

// Door-panel stripes from the Grid Labs Aston Martin livery.
const LIVERY_STRIPE = `
<svg class="card-signup__livery" viewBox="0 0 160 70" aria-hidden="true">
  <polygon points="58,0 160,0 160,70 34,70" fill="var(--fastest)"/>
  <polygon points="40,0 50,0 26,70 16,70" fill="var(--white)"/>
  <polygon points="26,0 31,0 7,70 2,70" fill="var(--white)"/>
  <line x1="62" y1="62" x2="160" y2="62" stroke="var(--cyan)" stroke-width="2"/>
</svg>`;

export function landingPage(inviteUrl: string): string {
  const body = `
<div class="hero-bg" aria-hidden="true">
  <video class="hero-bg__video" muted loop playsinline preload="none" poster="/hero-tunnel.jpg">
    <source src="/hero-tunnel.webm" type="video/webm">
  </video>
</div>

<section class="hero">
  <div>
    <h1>See where you lose time in Le&nbsp;Mans Ultimate</h1>
  </div>

  <div class="card-signup" id="join">
    ${LIVERY_STRIPE}
    <h2>Sign up</h2>
    <p class="card-signup__sub">It's free, but you need to be in the Grid Labs Discord server.</p>
    <form action="/auth/discord/login" method="get">
      <label class="field">
        <span class="field__label">Name</span>
        <input name="name" required autocomplete="name" placeholder="The name other drivers know you by">
      </label>
      <label class="field">
        <span class="field__label">Email</span>
        <input name="email" type="email" required autocomplete="email" placeholder="you@example.com">
      </label>
      <button class="btn btn--discord" type="submit">Continue with Discord</button>
    </form>
    <p class="card-signup__fine">
      We use Discord to check that you're in the server. We can't post anything from your account.
    </p>
    <p class="card-signup__fine">
      Not in the server yet? <a href="${escapeHtml(inviteUrl)}">Join the Discord</a> first.<br>
      Already have an account? <a href="/auth/discord/login">Log in with Discord</a>.
    </p>
  </div>
</section>

<script>
// Phones and reduced-motion users keep the poster and never download the video.
(function () {
  var v = document.querySelector(".hero-bg__video");
  if (!v) return;
  var mq = matchMedia("(min-width: 901px) and (prefers-reduced-motion: no-preference)");
  var onScreen = true;
  function sync() {
    if (mq.matches && onScreen && !document.hidden) v.play().catch(function () {});
    else v.pause();
  }
  new IntersectionObserver(function (entries) {
    onScreen = entries[0].isIntersecting;
    sync();
  }).observe(v);
  mq.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
})();
</script>`;

  return layout("Coaching for Le Mans Ultimate", body, null, {
    description:
      "Grid Labs records your Le Mans Ultimate laps and compares them to a reference lap, with an on-track overlay, voice engineer and club leaderboards. Free for Discord members.",
  });
}

export function notInDiscordPage(inviteUrl: string): string {
  const body = `
<div style="max-width:440px;margin:64px auto 0">
  <div class="panel" style="padding:30px;text-align:center">
    <h1 style="font-size:30px;margin-bottom:10px">Not in the Discord yet</h1>
    <p class="lede" style="font-size:15px;margin:0 auto 22px">
      Grid Labs is for members of our Discord server. Join it, then come back and sign up
      with the same Discord account.
    </p>
    <a class="btn btn--discord" href="${escapeHtml(inviteUrl)}">Join the Discord</a>
    <p class="card-signup__fine"><a href="/">Back to the home page</a></p>
  </div>
</div>`;

  return layout("Join the Discord", body);
}
