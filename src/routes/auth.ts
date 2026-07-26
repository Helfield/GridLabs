import { Hono } from "hono";
import type { Context, Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { db } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import type { AppVariables } from "../index";
import { notInDiscordPage } from "../views/landing";

const DISCORD_API = "https://discord.com/api/v10";

// Where users land if they're not in the Discord server yet -- shown as
// a rejection message with an invite link, per your requirement.
const DISCORD_INVITE_URL = process.env.DISCORD_INVITE_URL ?? "https://discord.gg/gTqcAhrnkU";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const authRoutes = new Hono();

// Step 1: redirect the user to Discord's authorize screen. `state` carries
// the name/email the user typed on our own signup form (if this is a new
// signup) so we still have it after Discord redirects back to us.
authRoutes.get("/discord/login", (c) => {
  const clientId = requiredEnv("DISCORD_CLIENT_ID");
  const redirectUri = requiredEnv("DISCORD_REDIRECT_URI");

  const name = c.req.query("name") ?? "";
  const email = c.req.query("email") ?? "";
  const state = Buffer.from(JSON.stringify({ name, email })).toString("base64url");

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  // "identify" + "email" get basic profile info; "guilds" lets us check
  // server membership, which is the actual gate.
  url.searchParams.set("scope", "identify email guilds");
  url.searchParams.set("state", state);

  return c.redirect(url.toString());
});

// Step 2: Discord redirects back here with a `code`. Exchange it for a
// token, fetch the user's Discord profile + guild list, verify they're a
// member of our server, then create (or log in) their account.
authRoutes.get("/discord/callback", async (c) => {
  const code = c.req.query("code");
  const stateRaw = c.req.query("state");
  if (!code) {
    return c.text("Missing authorization code from Discord.", 400);
  }

  let name = "";
  let email = "";
  if (stateRaw) {
    try {
      const decoded = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
      name = decoded.name ?? "";
      email = decoded.email ?? "";
    } catch {
      // malformed state -- proceed without it, Discord's own profile
      // data still gives us a name/email fallback below
    }
  }

  const clientId = requiredEnv("DISCORD_CLIENT_ID");
  const clientSecret = requiredEnv("DISCORD_CLIENT_SECRET");
  const redirectUri = requiredEnv("DISCORD_REDIRECT_URI");
  const guildId = requiredEnv("DISCORD_GUILD_ID");

  // Exchange the authorization code for an access token.
  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    console.error("Discord token exchange failed:", tokenResponse.status, errorBody);
    return c.text("Failed to authenticate with Discord. Please try again.", 502);
  }

  const tokenData = (await tokenResponse.json()) as { access_token: string };
  const accessToken = tokenData.access_token;

  // Fetch the Discord profile.
  const profileResponse = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileResponse.ok) {
    return c.text("Failed to fetch your Discord profile. Please try again.", 502);
  }
  const profile = (await profileResponse.json()) as {
    id: string;
    username: string;
    email: string | null;
    avatar: string | null;
  };

  // THE GATE: check the user's guild list for our server ID.
  const guildsResponse = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!guildsResponse.ok) {
    return c.text("Failed to verify Discord server membership. Please try again.", 502);
  }
  const guilds = (await guildsResponse.json()) as Array<{ id: string }>;
  const isMember = guilds.some((g) => g.id === guildId);

  if (!isMember) {
    // Rejected: not a member of the Discord server. Show a message with
    // the invite link rather than silently failing.
    return c.html(notInDiscordPage(DISCORD_INVITE_URL));
  }

  const avatarUrl = profile.avatar
    ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
    : null;

  // Coach accounts are determined by Discord ID, via a comma-separated
  // env var -- e.g. DISCORD_COACH_IDS="123456789012345678,987654321098765432".
  // Everyone else who passes the Discord membership gate is a student.
  const coachIds = (process.env.DISCORD_COACH_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const role = coachIds.includes(profile.id) ? "coach" : "student";

  // Create or update the account. `name`/`email` from our own signup form
  // take priority if provided; Discord's profile fills in gaps.
  const existing = await db.query.users.findFirst({
    where: eq(users.discordId, profile.id),
  });

  let userId: number;
  if (existing) {
    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        discordUsername: profile.username,
        discordAvatarUrl: avatarUrl,
        role,
      })
      .where(eq(users.id, existing.id));
    userId = existing.id;
  } else {
    const [created] = await db
      .insert(users)
      .values({
        name: name || profile.username,
        email: email || profile.email || `${profile.id}@discord.unknown`,
        discordId: profile.id,
        discordUsername: profile.username,
        discordAvatarUrl: avatarUrl,
        role,
      })
      .returning({ id: users.id });
    userId = created.id;
  }

  // Minimal session: a signed cookie holding the user id. Swap for a
  // proper session table / JWT if you want revocable sessions later --
  // fine as a starting point for Phase 1.
  setCookie(c, "session_user_id", String(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  return c.redirect("/dashboard");
});

authRoutes.post("/logout", (c) => {
  setCookie(c, "session_user_id", "", { maxAge: 0, path: "/" });
  return c.redirect("/");
});

// Simple auth middleware other routes can use: attaches c.get("userId")
// or responds 401.
export async function requireAuth(c: Context<{ Variables: AppVariables }>, next: Next) {
  const userId = getCookie(c, "session_user_id");
  if (!userId) {
    return c.redirect("/login");
  }
  c.set("userId", Number(userId));
  await next();
}
