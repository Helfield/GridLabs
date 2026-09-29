import { Hono } from "hono";
import { randomBytes } from "crypto";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import { getUserById } from "../db/queries";
import { db } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { accountPage } from "../views/account-pages";
import { validateDisplayName } from "../db/names";
import { syncAllLeaderboards } from "../discord/leaderboard";

export const accountRoutes = new Hono<{ Variables: AppVariables }>();

accountRoutes.use("*", requireAuth);

accountRoutes.get("/", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  // Result of a rename, carried back from the POST below.
  const error = c.req.query("name_error");
  const notice = error
    ? { kind: "error" as const, text: error.slice(0, 200) }
    : c.req.query("name") === "saved"
      ? { kind: "ok" as const, text: "Name updated." }
      : null;
  return c.html(accountPage(user, user.apiToken, notice));
});

// Change your own display name. Your Discord account and login are
// untouched -- this is only what the site (and the leaderboard) calls you.
accountRoutes.post("/name", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.parseBody();
  const check = validateDisplayName(body.name);
  if (!check.ok) {
    return c.redirect(`/account?name_error=${encodeURIComponent(check.message)}`);
  }

  await db.update(users).set({ name: check.name }).where(eq(users.id, userId));

  // The Discord board shows names as part of its picture, so it needs
  // redrawing. Not awaited: a slow or unreachable Discord must not make
  // a rename look like it failed. (No announcement: no record changed.)
  syncAllLeaderboards().catch((err) => {
    console.error("Discord leaderboard refresh after a rename failed:", err);
  });

  return c.redirect("/account?name=saved");
});

accountRoutes.post("/api-token/regenerate", async (c) => {
  const userId = c.get("userId");
  const token = randomBytes(24).toString("hex"); // 48-char hex string
  await db.update(users).set({ apiToken: token }).where(eq(users.id, userId));
  return c.redirect("/account");
});
