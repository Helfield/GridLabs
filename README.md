# Grid Labs — Le Mans Ultimate coaching platform

Discord-gated coach/student platform, built on Bun + Hono + Postgres
(Drizzle ORM), matching the stack IRP's other dashboards already run on
Railway.

## What's in this phase

- Database schema: `users` (coach/student, Discord-linked), `reference_laps`,
  `sessions`.
- Discord OAuth signup/login flow that rejects anyone not in your Discord
  server, showing an invite link instead.
- **Coach role assignment**: set `DISCORD_COACH_IDS` in `.env` to your own
  Discord user ID (comma-separated if there's more than one coach) --
  everyone else who passes the Discord membership gate becomes a student.
- **Designed UI**, built around motorsport timing convention: purple =
  fastest, green = above average, plain = slower. Those colours carry
  data, not decoration, so read them the way you'd read a timing screen.
  Pages: public landing page, "not in our Discord" page, driver
  dashboard (progress chart + lap history timing tower), single-lap
  detail, coach roster, per-driver view, and account/token setup.
  Plain CSS, no build step and no CDN — fonts are the only external
  request.
- Sector columns only appear once the desktop app sends sector splits.
  It currently uploads lap totals only, so those columns stay hidden
  and the lap-detail page says so plainly rather than showing blanks.

## Local setup

1. Install [Bun](https://bun.sh) if you don't have it.
2. `bun install`
3. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — a local Postgres connection string (or a Railway
     one, if you'd rather develop against a real hosted database from
     the start)
   - `DISCORD_CLIENT_SECRET` — from Discord's Developer Portal, OAuth2 →
     General → Reset Secret. The other Discord values are already filled
     in from what you gave me.
4. Push the schema to your database: `bun run db:generate && bun run db:migrate`
5. `bun run dev` — starts the server on port 3000.
6. Visit `http://localhost:3000` — you should see the signup form.

## Testing the flow

1. Fill in name + email, click "Continue with Discord."
2. You'll be sent to Discord's authorize screen.
3. If your Discord account is a member of the configured server, you'll
   land on `/dashboard` showing your new user ID.
4. If not, you'll see the "join our Discord first" rejection page with
   the invite link.

## Deploying to Railway

1. Push this to a GitHub repo (same as your other IRP dashboards).
2. Create a new Railway project, attach a Postgres plugin.
3. Set the same environment variables as `.env` in Railway's Variables
   tab — `DATABASE_URL` will already be provided by the Postgres plugin,
   just reference it.
4. In Discord's Developer Portal, add your Railway URL's callback as a
   second redirect: `https://your-app.up.railway.app/auth/discord/callback`
5. Update `DISCORD_REDIRECT_URI` in Railway's env vars to match.

## Uploading data (API token)

Each account can generate a personal API token from `/account` — this is
what the local telemetry bridge app uses to authenticate, since it isn't
a browser and can't use the login cookie.

Two endpoints, both requiring `Authorization: Bearer <token>`:

- `POST /api/sessions` — body: `{ track, car, lapTimeSeconds?, sector1Seconds?, sector2Seconds?, sector3Seconds?, referenceLapId? }`
- `POST /api/reference-laps` — body: `{ track, car, label, data, lapTimeSeconds?, isPublic? }` — `data` is the same JSON shape the local app's `ReferenceLap.save()` already produces.

Both return `{ id: <new row id> }` on success (201), or `{ error }` on
failure (400/401).

## What's next (Phase 3+)

- Session/reference-lap upload endpoints — **done**, see above.
- Wire the existing Python telemetry/coaching code to actually call these
  endpoints (next up).
- Progress trend charts (not just a table) once there's real session data.
- Ability for a coach to assign a reference lap to a student, or mark one
  of their own laps public so students can browse/use it.
- Proper session management (currently a bare cookie holding the user
  ID — fine to start, worth hardening before this handles real user data
  at scale).
- Google Sheets export (mentioned as a future want, not scoped yet).
