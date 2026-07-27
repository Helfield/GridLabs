import { Hono } from "hono";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import { getUserById } from "../db/queries";
import { downloadPage } from "../views/download-pages";

export const downloadRoutes = new Hono<{ Variables: AppVariables }>();

// Signed in only -- the app is the members' side of the Discord gate,
// so the download shouldn't be a public link people can pass around.
downloadRoutes.use("*", requireAuth);

downloadRoutes.get("/", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");

  // Where the build actually lives -- a GitHub release asset, or
  // wherever else you host it. Kept in an env var rather than the code
  // so publishing a new version is a Railway variable change, not a
  // commit and redeploy.
  const url = process.env.DOWNLOAD_URL || null;
  return c.html(downloadPage(user, url));
});