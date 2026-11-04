/**
 * coaching.ts
 *
 * The paid-coaching pages: what the club sells and what your account holds,
 * the live schedule the Live events package unlocks, and the staff screen that
 * adds or takes away access by hand until the checkout exists.
 */

import { layout, escapeHtml, type NavUser } from "./layout";
import { fullDate, shortDate } from "./components";
import {
  COACHING_CLASSES,
  entitlementCounts,
  GOAL_MAX,
  GOAL_MIN,
  LIVE_EVENTS,
  NOTE_MAX,
  ONE_TO_ONE,
  SIM_EXPERIENCE,
  noteRemovableBy,
} from "../coachingRules";
import { LICENCE_BANDS } from "../leagueRules";
import type { CoachingNote, CoachingProfile, CoachingStudentRow } from "../db/coaching";

type Nav = NonNullable<NavUser>;

/** A nav user plus the one thing the notes rules need and the nav type doesn't
 *  carry: which account it is. */
type Viewer = Nav & { id: number };

type Product = { slug: string; name: string; blurb: string; unlocks: string };
type Held = {
  slug: string;
  name: string;
  source: string;
  expiresAt: Date | null;
  createdAt: Date;
};
type Notice = { kind: "ok" | "error"; text: string } | null;

function notice(n: Notice): string {
  if (!n) return "";
  return `<p class="hint" style="color:${n.kind === "ok" ? "var(--pb)" : "var(--warn)"};margin-bottom:14px">${escapeHtml(n.text)}</p>`;
}

/** What a field says when the server refused what was typed into it. */
function errorText(errors: Record<string, string>, key: string): string {
  const e = errors[key];
  return e ? `<span class="field__err">${escapeHtml(e)}</span>` : "";
}

/** How a holding got there, in the member's words rather than the column's. */
function sourceText(source: string): string {
  return source === "manual" ? "by a coach" : "by subscription";
}

export function coachingHubPage(
  user: Nav,
  products: Product[],
  held: Held[],
  opts: { notice?: Notice; checkout?: Record<string, string> } = {},
): string {
  const live = held.filter((h) => entitlementCounts(h)).map((h) => h.slug);
  const staff = user.role === "coach" || user.role === "moderator";
  const checkout = opts.checkout ?? {};

  const accessPanel = `
<section class="panel">
  <div class="panel__head"><h2>Your access</h2></div>
  <div class="panel__body">
    ${
      held.length === 0
        ? `<div class="empty"><strong>Nothing on your account yet</strong>The two packages are below. Buy one, or message a coach in the club Discord and they'll put it on the account you sign in with.</div>`
        : `<div class="reflist">${held
            .map((h) => {
              const active = entitlementCounts(h);
              return `
      <div class="ref">
        <div>
          <div class="ref__label">${escapeHtml(h.name)}</div>
          <div class="ref__meta">Added ${escapeHtml(shortDate(h.createdAt))} ${escapeHtml(sourceText(h.source))}${
            h.expiresAt ? ` · runs to ${escapeHtml(fullDate(h.expiresAt))}` : ""
          }</div>
        </div>
        <div class="ref__time" style="color:${active ? "var(--pb)" : "var(--dim)"}">${active ? "Active" : "Lapsed"}</div>
      </div>`;
            })
            .join("")}</div>`
    }
    ${
      live.includes(ONE_TO_ONE)
        ? `<p class="hint"><a href="/coaching/portal" style="color:var(--text);text-decoration:underline;text-underline-offset:2px">Your portal</a>, where your profile and your coach's notes live.</p>`
        : ""
    }
    ${
      live.includes(LIVE_EVENTS)
        ? `<p class="hint"><a href="/coaching/live" style="color:var(--text);text-decoration:underline;text-underline-offset:2px">Live schedule</a>, which nights the club is on track.</p>`
        : ""
    }
  </div>
</section>`;

  const offerCards = products
    .map((p) => {
      const mine = live.includes(p.slug);
      const url = checkout[p.slug];
      return `
<section class="panel">
  <div class="panel__head"><h2>${escapeHtml(p.name)}</h2>${mine ? `<span class="tag">On your account</span>` : ""}</div>
  <div class="panel__body">
    <p class="lede">${escapeHtml(p.blurb)}</p>
    <p class="hint">${escapeHtml(p.unlocks)}</p>
    ${
      mine || !url
        ? ""
        : `<a class="btn btn--ghost" style="margin-top:10px" href="${escapeHtml(url)}" target="_blank" rel="noopener">Buy on Whop</a>`
    }
  </div>
</section>`;
    })
    .join("");

  const buyPanel = `
<section class="panel">
  <div class="panel__head"><h2>How to buy</h2></div>
  <div class="panel__body">
    <p class="lede">Checkout runs on Whop. Pay there and the package goes on the account you sign in with.</p>
    <p class="hint">Access follows your Discord sign-in rather than an email, so use the same Discord account in the app, on this site and at checkout. If it hasn't appeared on your account within a few minutes, message a coach in the club Discord and they'll add it by hand.</p>
  </div>
</section>`;

  const body = `
<div class="phead">
  <div>
    <span class="eyebrow">Grid Labs</span>
    <h1>Coaching</h1>
    <p class="phead__sub">What the club offers, and what your account has.</p>
  </div>
  ${
    staff
      ? `<a class="btn btn--ghost btn--sm" href="/coaching/students">Students</a>
  <a class="btn btn--ghost btn--sm" href="/coaching/admin">Manage access</a>`
      : ""
  }
</div>

${notice(opts.notice ?? null)}

${accessPanel}

<div class="grid-eq mt">
  ${offerCards}
</div>

${buyPanel}`;

  return layout("Coaching", body, user, { wallpaper: "garage" });
}

/** The nights the club runs on track together, next first. Unlocks the Live events package. */
export function liveSchedulePage(
  user: Nav,
  rounds: Array<{ league: string; round: number; track: string; eventDate: Date | null }>,
): string {
  const body = `
<div class="phead">
  <div>
    <span class="eyebrow">Coaching</span>
    <h1>Live schedule</h1>
    <p class="phead__sub">The club's sessions on track together, next first.</p>
  </div>
</div>

<section class="panel">
  <div class="panel__body">
    ${
      rounds.length === 0
        ? `<div class="empty"><strong>No dates set yet</strong>Rounds go on the calendar as the club confirms them, and the Discord posts each one a few hours before it starts.</div>`
        : `<table class="tower">
      <thead>
        <tr><th>Round</th><th>Track</th><th>Series</th><th class="col-r">Date</th></tr>
      </thead>
      <tbody>
        ${rounds
          .map(
            (r) => `
        <tr>
          <td class="pos">${escapeHtml(String(r.round))}</td>
          <td>${escapeHtml(r.track)}</td>
          <td class="t-slow">${escapeHtml(r.league)}</td>
          <td class="num col-r">${r.eventDate ? escapeHtml(fullDate(r.eventDate)) : `<span class="t-none">Not set</span>`}</td>
        </tr>`,
          )
          .join("")}
      </tbody>
    </table>`
    }
  </div>
</section>

<p class="chart-note">Times and the server password are posted in the Discord a few hours before each session.</p>`;

  return layout("Live schedule", body, user, { wallpaper: "pack" });
}

export type EntitlementListingRow = {
  entitlementId: number;
  userId: number;
  name: string;
  discordUsername: string;
  slug: string;
  productName: string;
  source: string;
  externalId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  grantedByName: string | null;
  lapsed: boolean;
};

/** Staff screen: who holds what, and the form that adds or removes a holding by hand. */
export function coachingAdminPage(
  user: Nav,
  products: Product[],
  rows: EntitlementListingRow[],
  candidates: Array<{ id: number; name: string; discordUsername: string; role: string }>,
  opts: { notice?: Notice } = {},
): string {
  const body = `
<a class="backlink" href="/coaching">Back to coaching</a>
<div class="phead">
  <div>
    <span class="eyebrow">Staff</span>
    <h1>Coaching access</h1>
    <p class="phead__sub">Who holds a package, and what put it there.</p>
  </div>
  <a class="btn btn--ghost btn--sm" href="/coaching/students">Students</a>
</div>

${notice(opts.notice ?? null)}

<section class="panel">
  <div class="panel__head"><h2>Holders</h2><span class="tag">${rows.length}</span></div>
  <div class="panel__body">
    ${
      rows.length === 0
        ? `<div class="empty"><strong>Nobody yet</strong>Grant access below once someone has paid the club.</div>`
        : `<table class="tower">
      <thead>
        <tr><th>Driver</th><th>Package</th><th>Added by</th><th>Runs to</th><th></th></tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
      <tr>
        <td>
          <div class="driver">
            <div>
              <div class="driver__name">${escapeHtml(r.name)}</div>
              <div class="driver__handle">@${escapeHtml(r.discordUsername)}</div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(r.productName)}${r.lapsed ? ` <span class="tag">lapsed</span>` : ""}</td>
        <td class="t-slow">${
          r.source === "manual"
            ? `${escapeHtml(r.grantedByName ?? "a coach")} · ${escapeHtml(shortDate(r.createdAt))}`
            : `subscription${r.externalId ? ` · ${escapeHtml(r.externalId)}` : ""}`
        }</td>
        <td class="num">${r.expiresAt ? escapeHtml(fullDate(r.expiresAt)) : `<span class="t-none">No end</span>`}</td>
        <td class="col-r">
          <form action="/coaching/admin/revoke" method="post">
            <input type="hidden" name="userId" value="${r.userId}">
            <input type="hidden" name="slug" value="${escapeHtml(r.slug)}">
            <button class="linkbtn" type="submit">Remove</button>
          </form>
        </td>
      </tr>`,
          )
          .join("")}
      </tbody>
    </table>`
    }
  </div>
</section>

<div class="grid-eq mt">
  <section class="panel">
    <div class="panel__head"><h2>Grant access</h2></div>
    <div class="panel__body">
      <form action="/coaching/admin/grant" method="post">
        <label class="field">
          <span class="field__label">Driver</span>
          <select name="userId" required>
            <option value="">Choose a member</option>
            ${candidates
              .map(
                (c) =>
                  `<option value="${c.id}">${escapeHtml(c.name)} · @${escapeHtml(c.discordUsername)}${
                    c.role === "moderator" ? " (moderator)" : ""
                  }</option>`,
              )
              .join("")}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Package</span>
          <select name="slug" required>
            ${products.map((p) => `<option value="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Runs until (optional)</span>
          <input type="date" name="expires">
          <span class="hint">Blank means it doesn't run out. A subscription's own end date is written by the gateway, not here.</span>
        </label>
        <button class="btn btn--ghost" type="submit">Grant access</button>
      </form>
    </div>
  </section>
  <section class="panel">
    <div class="panel__head"><h2>What this table decides</h2></div>
    <div class="panel__body">
      <p class="lede">Holding a package here is the only thing that opens the coaching portal. A driver's role doesn't, so a coach who buys the 1-on-1 package is a member of it like anyone else.</p>
      <p class="hint">When the checkout is connected, Whop's own events write these rows instead of this form. Nothing on the site changes.</p>
    </div>
  </section>
</div>`;

  return layout("Coaching access", body, user, { wide: true, wallpaper: "garage" });
}

// ---------------------------------------------------------------- portal

/** Everything the intake form shows, whether from a saved profile, a rejected
 *  submission, or the account and league registration it can prefill from. */
export type IntakeValues = {
  name: string;
  email: string;
  srBand: string | null;
  drBand: string | null;
  experience: string | null;
  classes: string[];
  goal: string;
  setupLink: string | null;
  video: string;
};

function bandDropdown(name: string, label: string, selected: string | null, errors: Record<string, string>): string {
  const options = [
    `<option value=""${selected ? "" : " selected"}>Choose your band</option>`,
    ...LICENCE_BANDS.map((b) => `<option value="${escapeHtml(b)}"${selected === b ? " selected" : ""}>${escapeHtml(b)}</option>`),
  ].join("");
  return `<label class="field"><span class="field__label">${label}</span><select name="${name}">${options}</select>${errorText(errors, name)}</label>`;
}

/**
 * A pick-several group rendered as pills rather than a list of ticks.
 *
 * Whatever a saved profile holds that today's list doesn't offer is added to the
 * end and stays ticked, so a class the club stops scoring still comes back as the
 * answer the driver gave rather than vanishing on their next edit.
 */
function chipGroup(
  name: string,
  label: string,
  offered: string[],
  selected: string[],
  errors: Record<string, string>,
  hint: string,
): string {
  const choices = [...offered, ...selected.filter((s) => !offered.includes(s))];
  const pills = choices
    .map(
      (c) =>
        `<label class="chip"><input type="checkbox" name="${name}" value="${escapeHtml(c)}"${
          selected.includes(c) ? " checked" : ""
        }>${escapeHtml(c)}</label>`,
    )
    .join("");
  return `<div class="field"><span class="field__label">${label}</span><div class="chips">${pills}</div>${errorText(
    errors,
    name,
  )}${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
}

function urlField(
  name: string,
  label: string,
  value: string | null,
  placeholder: string,
  errors: Record<string, string>,
  hint: string,
  required = false,
): string {
  // The reason and the note live inside the field so the gap below a link matches
  // the gap below every other question on the form.
  return `<label class="field"><span class="field__label">${label}</span><input type="url" name="${name}" value="${escapeHtml(
    value ?? "",
  )}" placeholder="${escapeHtml(placeholder)}" maxlength="400"${required ? " required" : ""}>${errorText(
    errors,
    name,
  )}<span class="hint">${hint}</span></label>`;
}

/**
 * The intake form a paid member fills in before their first session.
 *
 * Grouped the way a coach reads it: who they are, what they want worked on, and
 * what the coach will watch. The two links are the last thing on the page because
 * they're the part that takes the most doing, and nobody should meet that before
 * deciding the rest is worth filling in.
 *
 * There's no track question. The recording asked for below names the one track
 * they most want to improve on, which is the only track a coach needs before the
 * first session; anything else they want is in the goal.
 */
export function coachingIntakePage(
  user: Nav,
  opts: {
    values: IntakeValues;
    errors?: Record<string, string>;
    notice?: Notice;
    editing: boolean;
  },
): string {
  const { values } = opts;
  const errors = opts.errors ?? {};
  const v = (s: string | null | undefined) => escapeHtml(s ?? "");

  const body = `
<a class="backlink" href="/coaching">Back to coaching</a>
<div class="phead">
  <div>
    <span class="eyebrow">Coaching</span>
    <h1>${opts.editing ? "Your coaching profile" : "Tell your coach who you are"}</h1>
    <p class="phead__sub">${
      opts.editing
        ? "What your coach sees before your sessions. Change anything here and it's theirs the moment you save."
        : "The first thing your coach reads. It takes about three minutes, and the more of it is filled in, the less of your first session goes on finding out."
    }</p>
  </div>
</div>

${notice(opts.notice ?? null)}

<form action="/coaching/portal" method="post">
  <section class="panel">
    <div class="panel__head"><h2>You</h2></div>
    <div class="panel__body">
      <div class="form-2">
        <label class="field"><span class="field__label">Name</span>
          <input type="text" name="name" value="${v(values.name)}" maxlength="80" required placeholder="The name your coach calls you">
          ${errorText(errors, "name")}
        </label>
        <label class="field"><span class="field__label">Email</span>
          <input type="email" name="email" value="${v(values.email)}" maxlength="120" required placeholder="you@example.com">
          ${errorText(errors, "email")}
        </label>
      </div>
      <div class="form-2">
        ${bandDropdown("srBand", "Safety Rating band (SR)", values.srBand, errors)}
        ${bandDropdown("drBand", "Driver Rating band (DR)", values.drBand, errors)}
      </div>
      <label class="field"><span class="field__label">How long you've been sim racing</span>
        <select name="experience">
          <option value=""${values.experience ? "" : " selected"}>Choose how long</option>
          ${SIM_EXPERIENCE.map(
            (e) => `<option value="${escapeHtml(e)}"${values.experience === e ? " selected" : ""}>${escapeHtml(e)}</option>`,
          ).join("")}
        </select>
        ${errorText(errors, "experience")}
      </label>
      <p class="hint">The bands come from your league registration if you have one. Update them here if your licence has moved since.</p>
    </div>
  </section>

  <section class="panel mt">
    <div class="panel__head"><h2>What you want worked on</h2></div>
    <div class="panel__body">
      <p class="lede" style="margin-bottom:20px">Coaching isn't only about one circuit. The techniques and the mechanics behind a fast lap carry over to every track, so what you fix at Spa is worth something at Portimao too.</p>
      ${chipGroup("classes", "Classes", COACHING_CLASSES, values.classes, errors, "Tick every class you want seat time in, not only the one you race most.")}
      <label class="field"><span class="field__label">What you want out of this</span>
        <textarea name="goal" rows="4" maxlength="${GOAL_MAX}" required placeholder="Where you are now, where you want to be, and by when">${v(values.goal)}</textarea>
        ${errorText(errors, "goal")}
        <span class="hint">${GOAL_MIN} characters or more, and name the track you most want to work on. "Qualifying pace in the GTE at Spa" is worth more to a coach than "get faster".</span>
      </label>
    </div>
  </section>

  <section class="panel mt">
    <div class="panel__head"><h2>For your coach to watch</h2></div>
    <div class="panel__body">
      ${urlField(
        "video",
        "Your fastest lap at that track on YouTube",
        values.video,
        "https://www.youtube.com/watch?v=...",
        errors,
        "One clean lap of your best, at the track you most want to improve on. Unlisted is fine, it just has to open.",
        true,
      )}
      ${urlField(
        "setupLink",
        "A photo of your setup (optional)",
        values.setupLink,
        "https://imgur.com/...",
        errors,
        "Host it anywhere that gives you a direct link to the image. Wheelbase and pedal position are the first things a coach asks about.",
      )}
    </div>
  </section>

  <div class="mt" style="display:flex;gap:12px;align-items:center">
    <button class="btn btn--ghost" type="submit">${opts.editing ? "Save changes" : "Send it to my coach"}</button>
    <a class="backlink" style="margin:0" href="/coaching">Back</a>
  </div>
</form>`;

  return layout(opts.editing ? "Your coaching profile" : "Coaching intake", body, user, { wallpaper: "garage" });
}

/**
 * The portal as its owner sees it once the intake is in.
 *
 * Same facts as the form, read-only, with their coach's notes underneath. The
 * notes are the same rows the coach writes and reads: there is one kind of note on
 * this site, so the member isn't looking at a sanitised copy of what was said.
 */
export function coachingProfilePage(
  user: Viewer,
  profile: CoachingProfile,
  opts: { notice?: Notice; notes: CoachingNote[] },
): string {
  const body = `
<div class="phead">
  <div>
    <span class="eyebrow">Coaching</span>
    <h1>Your portal</h1>
    <p class="phead__sub">Details saved ${escapeHtml(fullDate(profile.updatedAt))}. Your coach reads this before your sessions.</p>
  </div>
  <a class="btn btn--ghost btn--sm" href="/coaching/portal/edit">Edit details</a>
</div>

${notice(opts.notice ?? null)}

${profilePanels(profile, true)}

<section class="panel mt">
  <div class="panel__head"><h2>Your coach's notes</h2><span class="tag">${opts.notes.length}</span></div>
  <div class="panel__body">${notesThread(opts.notes, user)}</div>
</section>

<p class="chart-note">Nothing here is public. It's your account, your coach, and whoever moderates the club.</p>`;

  return layout("Your portal", body, user, { wallpaper: "garage" });
}

// ---------------------------------------------------------------- staff: notes

/**
 * Who holds the 1-on-1 package, and how much of each of their profiles exists.
 * A coach's working list: the row they open is the one they're about to coach.
 */
export function coachingStudentsPage(
  user: Nav,
  rows: CoachingStudentRow[],
  opts: { notice?: Notice } = {},
): string {
  const body = `
<a class="backlink" href="/coaching">Back to coaching</a>
<div class="phead">
  <div>
    <span class="eyebrow">Staff</span>
    <h1>Students</h1>
    <p class="phead__sub">Everyone holding the 1-on-1 package, and what's on their profile.</p>
  </div>
  <a class="btn btn--ghost btn--sm" href="/coaching/admin">Manage access</a>
</div>

${notice(opts.notice ?? null)}

<section class="panel">
  <div class="panel__head"><h2>The list</h2><span class="tag">${rows.length}</span></div>
  <div class="panel__body">
    ${
      rows.length === 0
        ? `<div class="empty"><strong>Nobody holds it yet</strong>Grant the 1-on-1 package from <a href="/coaching/admin" style="color:var(--text);text-decoration:underline;text-underline-offset:2px">Manage access</a> once someone has paid the club.</div>`
        : `<table class="tower">
      <thead>
        <tr><th>Driver</th><th>Intake</th><th class="col-r">Notes</th><th class="chev"></th></tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
      <tr class="is-link" onclick="window.location='/coaching/students/${r.userId}'">
        <td>
          <div class="driver">
            <div>
              <div class="driver__name">${escapeHtml(r.name)}</div>
              <div class="driver__handle">@${escapeHtml(r.discordUsername)}</div>
            </div>
          </div>
        </td>
        <td class="t-slow">${r.intakeAt ? escapeHtml(shortDate(r.intakeAt)) : `<span class="t-none">Not filled in</span>`}</td>
        <td class="num col-r">${
          r.noteCount > 0
            ? `${r.noteCount}${
                r.lastNoteAt ? `<div class="driver__handle">${escapeHtml(shortDate(r.lastNoteAt))}</div>` : ""
              }`
            : `<span class="t-none">None</span>`
        }</td>
        <td class="chev">›</td>
      </tr>`,
          )
          .join("")}
      </tbody>
    </table>`
    }
  </div>
</section>

<p class="chart-note">Notes are written on a driver's page here and read on their own portal, and both sides see the same ones.</p>`;

  return layout("Students", body, user, { wide: true, wallpaper: "garage" });
}

/**
 * One driver's profile as their coach sees it: the intake they filled in, the
 * notes on it, and the box that adds the next one.
 *
 * The intake panels are the member's own page, unchanged, so what a coach reads is
 * literally what the driver wrote rather than a summary of it someone could edit
 * into something else.
 */
export function coachingStudentPage(
  user: Viewer,
  student: { id: number; name: string; discordUsername: string },
  profile: CoachingProfile | null,
  notes: CoachingNote[],
  opts: { notice?: Notice; error?: string | null; draft?: string } = {},
): string {
  const body = `
<a class="backlink" href="/coaching/students">Back to students</a>
<div class="phead">
  <div>
    <span class="eyebrow">Student</span>
    <h1>${escapeHtml(student.name)}</h1>
    <p class="phead__sub">@${escapeHtml(student.discordUsername)} · ${
      profile ? `intake saved ${escapeHtml(fullDate(profile.updatedAt))}` : "no intake yet"
    }</p>
  </div>
</div>

${notice(opts.notice ?? null)}

${
  profile
    ? profilePanels(profile, false)
    : `<section class="panel">
  <div class="panel__head"><h2>Their profile</h2></div>
  <div class="panel__body"><div class="empty"><strong>No intake yet</strong>They hold the package but haven't filled in their details. The form is on their portal, and notes you write now are theirs to read as soon as it is.</div></div>
</section>`
}

<section class="panel mt">
  <div class="panel__head"><h2>Notes</h2><span class="tag">${notes.length}</span></div>
  <div class="panel__body">
    ${notesThread(notes, user)}
    <form action="/coaching/students/${student.id}/notes" method="post" class="mt">
      <label class="field">
        <span class="field__label">Write a note</span>
        <textarea name="body" rows="4" maxlength="${NOTE_MAX}" placeholder="What you worked on, what they did with it, what to start on next.">${escapeHtml(
          opts.draft ?? "",
        )}</textarea>
        ${opts.error ? `<span class="field__err">${escapeHtml(opts.error)}</span>` : ""}
        <span class="hint">Saved as its own entry with today's date, and the driver sees it the moment you save it. Notes can be removed but not rewritten.</span>
      </label>
      <button class="btn btn--ghost" type="submit">Save note</button>
    </form>
  </div>
</section>`;

  return layout(`${student.name}, coaching notes`, body, user, { wide: true, wallpaper: "garage" });
}

/**
 * The note thread, newest first.
 *
 * One renderer for both pages because there is one kind of note. The only thing
 * that differs between the member's copy and a coach's is whether the Remove
 * button appears, and that is the rule in noteRemovableBy rather than a decision
 * made twice by whoever asked for the list.
 */
function notesThread(notes: CoachingNote[], viewer: Viewer): string {
  if (notes.length === 0) {
    return `<div class="empty"><strong>Nothing written yet</strong>What a coach saves about this driver shows up here, newest first.</div>`;
  }
  return `<div class="reflist">${notes
    .map(
      (n) => `
      <div class="ref" style="align-items:flex-start">
        <div style="min-width:0">
          <div class="ref__label">${escapeHtml(n.authorName)}</div>
          <div class="ref__meta">${escapeHtml(fullDate(n.createdAt))}</div>
          <p style="margin:9px 0 0;font-size:14px;white-space:pre-wrap">${escapeHtml(n.body)}</p>
        </div>
        ${
          noteRemovableBy(n, viewer)
            ? `<form action="/coaching/notes/remove" method="post">
          <input type="hidden" name="noteId" value="${n.id}">
          <button class="linkbtn" type="submit">Remove</button>
        </form>`
            : ""
        }
      </div>`,
    )
    .join("")}</div>`;
}

/** A label and the driver's own answer beside it. */
function profileRow(label: string, value: string): string {
  return `<div class="ref"><div><div class="ref__label">${escapeHtml(label)}</div></div><div class="ref__time" style="color:var(--text);font-family:var(--font-text);text-align:right">${value}</div></div>`;
}

function classPills(items: string[]): string {
  return `<div class="chips" style="justify-content:flex-end">${items.map((i) => `<span class="tag">${escapeHtml(i)}</span>`).join("")}</div>`;
}

/**
 * The intake, read-only, in the order the form asks for it.
 *
 * Both readers get the same rows; only the headings and the closing hint change,
 * because "You" on a coach's page would name the wrong person and a coach can't
 * edit what they're reading.
 */
function profilePanels(profile: CoachingProfile, forOwner: boolean): string {
  return `<section class="panel">
  <div class="panel__head"><h2>${forOwner ? "You" : "Their profile"}</h2></div>
  <div class="panel__body"><div class="reflist">
    ${profileRow("Name", escapeHtml(profile.name))}
    ${profileRow(
      "Email",
      `<a href="mailto:${escapeHtml(profile.email)}" style="color:var(--text);text-decoration:underline;text-underline-offset:2px">${escapeHtml(
        profile.email,
      )}</a>`,
    )}
    ${profileRow("Sim racing", escapeHtml(profile.experience))}
    ${profileRow("Bands", `${escapeHtml(profile.srBand)} SR · ${escapeHtml(profile.drBand)} DR`)}
  </div></div>
</section>

<section class="panel mt">
  <div class="panel__head"><h2>${forOwner ? "What you want worked on" : "What they want worked on"}</h2></div>
  <div class="panel__body"><div class="reflist">
    ${profileRow("Classes", classPills(profile.classes))}
  </div>
    <p class="lede" style="margin-top:18px">${escapeHtml(profile.goal)}</p>
  </div>
</section>

<section class="panel mt">
  <div class="panel__head"><h2>${forOwner ? "For your coach to watch" : "For the coach to watch"}</h2></div>
  <div class="panel__body"><div class="reflist">
    ${profileRow(
      "Fastest lap",
      `<a href="${escapeHtml(profile.video)}" target="_blank" rel="noopener noreferrer" style="color:var(--text);text-decoration:underline;text-underline-offset:2px">Open the video</a>`,
    )}
    ${profileRow(
      "Setup photo",
      profile.setupLink
        ? `<a href="${escapeHtml(profile.setupLink)}" target="_blank" rel="noopener noreferrer" style="color:var(--text);text-decoration:underline;text-underline-offset:2px">Open the image</a>`
        : `<span class="t-none">Not added</span>`,
    )}
  </div>
    <p class="hint">${
      !forOwner
        ? profile.setupLink
          ? "They can change any of this themselves, so read it as the latest version rather than the one you saw last."
          : "Ask for the setup photo in the first session. It's the one thing here a coach can't guess."
        : profile.setupLink
          ? "Anything here can be changed later from Edit details, and your coach sees the new version straight away."
          : "A missing setup photo is the one thing here a coach will ask for in your first session. Add it any time from Edit details."
    }</p>
  </div>
</section>`;
}
