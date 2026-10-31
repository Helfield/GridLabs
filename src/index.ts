import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { authRoutes, requireAuth } from "./routes/auth";
import { coachRoutes } from "./routes/coach";
import { studentRoutes } from "./routes/student";
import { accountRoutes } from "./routes/account";
import { apiRoutes } from "./routes/api";
import { getUserById } from "./db/queries";
import { landingPage } from "./views/landing";
import { privacyPage } from "./views/privacy";
import { sessionRoutes } from "./routes/session";
import { libraryRoutes } from "./routes/library";
import { downloadRoutes } from "./routes/download";
import { leagueRoutes } from "./routes/league";
import { versionRoutes } from "./routes/version";
import { leaderboardEnabled, syncAllLeaderboards } from "./discord/leaderboard";
import { promoteBestLaps } from "./db/promotions";
import { ensureSchema } from "./db/ensure-schema";
import { startBot } from "./discord/gateway";

// Before anything can query: add any column this version needs. A
// failure is logged rather than fatal -- if the database is briefly
// unreachable the site should still come up and retry on its own queries.
await ensureSchema().catch((err) => console.error("ensureSchema failed:", err));

export type AppVariables = { userId: number };

const DISCORD_INVITE_URL = process.env.DISCORD_INVITE_URL ?? "https://discord.gg/gTqcAhrnkU";

const app = new Hono<{ Variables: AppVariables }>();

// Icons + social preview image, referenced from layout.ts's <head>.
// Explicit one-file-each routes rather than a wildcard mount -- there's
// only a handful of these and it means there's no chance of a static
// route ever shadowing a real one under app.route() below.
const STATIC_ASSETS = [
  "favicon.svg",
  "favicon-16.png",
  "favicon-32.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "og-image.png",
  "hero-tunnel.jpg",
  "hero-tunnel.webm",
] as const;
for (const file of STATIC_ASSETS) {
  app.get(`/${file}`, serveStatic({ path: `./public/${file}` }));
}
// The three page wallpapers. Cached like the fonts: the filename changes when
// the picture does, so a stale copy is never worth re-downloading.
const WALLPAPERS = ["bg-asphalt.webp", "bg-kerb.webp", "bg-spapark.webp"] as const;
for (const file of WALLPAPERS) {
  app.get(
    `/${file}`,
    serveStatic({
      path: `./public/${file}`,
      mimes: { webp: "image/webp" },
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=604800");
      },
    }),
  );
}
const FONTS = ["race-sport.ttf"] as const;
for (const file of FONTS) {
  app.get(
    `/fonts/${file}`,
    serveStatic({
      path: `./public/fonts/${file}`,
      // serveStatic sends no validators, so without this every page load re-downloads the fonts.
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=604800");
      },
    }),
  );
}
app.get(
  "/site.webmanifest",
  serveStatic({
    path: "./public/site.webmanifest",
    mimes: { webmanifest: "application/manifest+json" },
  }),
);

app.route("/auth", authRoutes);
app.route("/coach", coachRoutes);
app.route("/student", studentRoutes);
app.route("/account", accountRoutes);
app.route("/api", apiRoutes);
app.route("/session", sessionRoutes);
app.route("/library", libraryRoutes);
app.route("/download", downloadRoutes);
app.route("/league", leagueRoutes);

// No auth, no db: which commit and branch this process booted from.
app.route("/version", versionRoutes);

app.get("/", (c) => {
  return c.html(landingPage(DISCORD_INVITE_URL));
});

// Public privacy policy (no auth) -- linked from the footer and required by
// Google to publish the OAuth consent screen.
app.get("/privacy", (c) => c.html(privacyPage()));

// Sends a logged-in user to the right place for their role, so links to
// "/dashboard" (e.g. from an email, or old bookmarks) always resolve
// sensibly regardless of whether they're a coach or a student.
app.get("/dashboard", requireAuth, async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  return c.redirect(user.role === "coach" ? "/coach" : "/student");
});

// Straight into Discord OAuth. This used to bounce to the landing page,
// whose "Get access" form insists on a name and email before it will
// continue -- fine for a first signup, a dead end for someone who
// already has an account and just got sent here by requireAuth. The
// callback looks accounts up by Discord ID, so a returning user needs
// nothing more than the Discord round-trip.
app.get("/login", (c) => c.redirect("/auth/discord/login"));

// Publish the fastest valid lap per track and car class as its reference
// lap, from everything uploaded so far. Uploads do this themselves as
// they arrive; this catches laps driven before that existed. Idempotent,
// and delayed so it never competes with the first requests after a
// deploy.
setTimeout(() => {
  promoteBestLaps()
    .then((r) =>
      console.log(
        `Reference laps: ${r.promoted} new fastest lap(s) published, ${r.unpublished} invalid one(s) taken down, across ${r.tracks} track(s).`,
      ),
    )
    .catch((err) => console.error("Reference-lap backfill failed:", err));
}, 3000);

// Bring the Discord leaderboard channel up to date shortly after boot.
// Cheap when nothing changed (each track's board is hashed and only
// edited on a difference), and it's what first populates the channel
// the moment the webhook variable is set, without anyone clicking
// anything. Delayed so it never competes with serving the first
// requests after a deploy.
if (leaderboardEnabled()) {
  setTimeout(() => {
    syncAllLeaderboards()
      .then((r) => console.log(`Discord leaderboard: ${r.tracks} track(s) checked.`))
      .catch((err) => console.error("Discord leaderboard startup sync failed:", err));
  }, 5000);
} else {
  console.log("Discord leaderboard: off (DISCORD_LEADERBOARD_WEBHOOK_URL not set).");
}

// The bot's live Discord connection (reaction roles). Needs the tables
// ensureSchema made above; does nothing unless DISCORD_BOT_TOKEN is set.
startBot();

export default app;