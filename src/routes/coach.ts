import { Hono } from "hono";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import { getUserById, getAllStudents, getStudentDetail } from "../db/queries";
import { coachDashboardPage, driverDetailPage } from "../views/coach-pages";

export const coachRoutes = new Hono<{ Variables: AppVariables }>();

coachRoutes.use("*", requireAuth);

// Only coaches get past here -- students hitting these routes directly
// get redirected to their own dashboard instead.
coachRoutes.use("*", async (c, next) => {
  const user = await getUserById(c.get("userId"));
  if (!user || user.role !== "coach") {
    return c.redirect("/student");
  }
  await next();
});

coachRoutes.get("/", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");

  const students = await getAllStudents();
  return c.html(coachDashboardPage(user, students));
});

coachRoutes.get("/driver/:id", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");

  const studentId = Number(c.req.param("id"));
  const detail = await getStudentDetail(studentId);
  if (!detail) {
    return c.text("Driver not found.", 404);
  }

  return c.html(driverDetailPage(user, detail.student, detail.sessions, detail.referenceLaps));
});
