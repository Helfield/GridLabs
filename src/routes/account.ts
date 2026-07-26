import { Hono } from "hono";
import { randomBytes } from "crypto";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import { getUserById } from "../db/queries";
import { db } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { accountPage } from "../views/account-pages";

export const accountRoutes = new Hono<{ Variables: AppVariables }>();

accountRoutes.use("*", requireAuth);

accountRoutes.get("/", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  return c.html(accountPage(user, user.apiToken));
});

accountRoutes.post("/api-token/regenerate", async (c) => {
  const userId = c.get("userId");
  const token = randomBytes(24).toString("hex"); // 48-char hex string
  await db.update(users).set({ apiToken: token }).where(eq(users.id, userId));
  return c.redirect("/account");
});
