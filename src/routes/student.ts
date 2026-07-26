import { Hono } from "hono";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import { getUserById, getSessionsForUser, getReferenceLapsForUser, getPublicReferenceLaps } from "../db/queries";
import { studentDashboardPage } from "../views/student-pages";

export const studentRoutes = new Hono<{ Variables: AppVariables }>();

studentRoutes.use("*", requireAuth);

studentRoutes.get("/", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");

  const [mySessions, myLaps, publicLaps] = await Promise.all([
    getSessionsForUser(user.id),
    getReferenceLapsForUser(user.id),
    getPublicReferenceLaps(),
  ]);

  return c.html(studentDashboardPage(user, mySessions, myLaps, publicLaps));
});
