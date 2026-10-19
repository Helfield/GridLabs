import { layout, escapeHtml, type NavUser } from "./layout";
import { NAME_MAX } from "../db/names";

type Nav = NonNullable<NavUser>;

export function accountPage(
  navUser: Nav,
  apiToken: string | null,
  notice: { kind: "ok" | "error"; text: string } | null = null,
): string {
  const tokenBlock = apiToken
    ? `
    <div class="token">${escapeHtml(apiToken)}</div>
    <p class="hint">
      Paste this into <span class="mono">web_config.json</span> in the desktop app folder, as
      <span class="mono">api_token</span>. Treat it like a password — anyone with it can post laps
      to your account. Generating a new one immediately stops the old one working.
    </p>`
    : `
    <div class="empty" style="padding:26px 8px">
      <strong>No token yet</strong>
      Generate one to connect the desktop app to this account.
    </div>`;

  const body = `
<div class="phead">
  <div>
    <span class="eyebrow">Account</span>
    <h1>${escapeHtml(navUser.name)}</h1>
    <p class="phead__sub">Signed in with Discord · ${escapeHtml(navUser.role)}</p>
  </div>
</div>

<section class="panel" style="margin-bottom:22px">
  <div class="panel__head"><h2>Display name</h2></div>
  <div class="panel__body">
    <p class="hint" style="margin-top:0">This is the name shown on your laps, the driver list and the Discord leaderboard. Changing it doesn't affect your Discord account or your login.</p>
    ${
      notice
        ? `<p class="hint" style="color:${notice.kind === "ok" ? "var(--pb)" : "var(--warn)"};margin-bottom:10px">${escapeHtml(notice.text)}</p>`
        : ""
    }
    <form action="/account/name" method="post" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
      <label class="field" style="margin:0;flex:1;min-width:220px">
        <span class="field__label">Name</span>
        <input name="name" required minlength="2" maxlength="${NAME_MAX}" value="${escapeHtml(navUser.name)}" autocomplete="nickname" spellcheck="false">
      </label>
      <button class="btn btn--ghost btn--sm" type="submit">Save name</button>
    </form>
  </div>
</section>

<div class="grid-2">
  <section class="panel">
    <div class="panel__head">
      <h2>Desktop app token</h2>
      <span class="tag">${apiToken ? "Active" : "Not set up"}</span>
    </div>
    <div class="panel__body">
      ${tokenBlock}
      <form action="/account/api-token/regenerate" method="post" style="margin-top:16px">
        <button class="btn btn--ghost btn--sm" type="submit">
          ${apiToken ? "Generate a new token" : "Generate token"}
        </button>
      </form>
    </div>
  </section>

  <section class="panel">
    <div class="panel__head"><h2>Connecting up</h2></div>
    <div class="panel__body">
      <div class="reflist">
        <div class="ref" style="align-items:flex-start">
          <div>
            <div class="ref__label">1 · Generate a token</div>
            <div class="ref__meta" style="text-transform:none;letter-spacing:0">Use the button on the left.</div>
          </div>
        </div>
        <div class="ref" style="align-items:flex-start">
          <div>
            <div class="ref__label">2 · Add it to the app</div>
            <div class="ref__meta" style="text-transform:none;letter-spacing:0">
              Open <span class="mono">web_config.json</span> and paste the token in.
            </div>
          </div>
        </div>
        <div class="ref" style="align-items:flex-start">
          <div>
            <div class="ref__label">3 · Drive</div>
            <div class="ref__meta" style="text-transform:none;letter-spacing:0">
              Finished laps upload on their own. Nothing to press.
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</div>`;

  return layout("Account", body, navUser);
}
