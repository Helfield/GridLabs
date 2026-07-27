import { Hono } from "hono";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import {
  getUserById,
  getAllStudents,
  getStudentDetail,
  getPublicReferenceLaps,
  createReferenceLap,
  deleteReferenceLap,
} from "../db/queries";
import { coachDashboardPage, driverDetailPage, referenceLapsPage } from "../views/coach-pages";

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

// Global reference laps: upload a lap here and it appears for every
// student instantly via getPublicReferenceLaps(), no manual redownload.
coachRoutes.get("/reference-laps", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  const laps = await getPublicReferenceLaps();
  return c.html(referenceLapsPage(user, laps));
});

coachRoutes.post("/reference-laps", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");

  const body = await c.req.parseBody();
  const track = typeof body.track === "string" ? body.track.trim() : "";
  const car = typeof body.car === "string" ? body.car.trim() : "";
  // Display-only name. Never matched against telemetry -- purely so a
  // student reading the list knows what car the lap is in.
  const carDisplay = typeof body.carDisplay === "string" ? body.carDisplay.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const lapTimeSeconds = parseLapTime(typeof body.lapTime === "string" ? body.lapTime : "");
  const file = body.dataFile;

  if (!track || !car || !label || !(file instanceof File)) {
    return c.text("Missing required fields: track, car, label, and a reference lap JSON file.", 400);
  }

  let data: unknown;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    return c.text("The uploaded file isn't valid JSON.", 400);
  }

  await createReferenceLap({
    ownerId: user.id,
    track,
    car,
    carDisplay: carDisplay || null,
    label,
    data,
    lapTimeSeconds,
    isPublic: true,
  });

  return c.redirect("/coach/reference-laps");
});

coachRoutes.post("/reference-laps/:id/delete", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isFinite(id)) {
    await deleteReferenceLap(id);
  }
  return c.redirect("/coach/reference-laps");
});

/**
 * Lap time as a driver would type it -- "2:03.373" -- into seconds.
 *
 * Nobody reads a lap in raw seconds, so the form asks for the timing-screen
 * format. The millisecond separator is deliberately loose: "." is correct,
 * but ":" and "," are both common enough (and "2:03:373" is what a lot of
 * people type) that rejecting them would just be pedantry. A plain number
 * still works too, so anyone already used to entering seconds isn't broken.
 *
 * Returns null for empty or unparseable input rather than 0 -- a lap with
 * no time recorded is a real state, and a lap time of zero is not.
 */
function parseLapTime(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;

  const match = text.match(/^(\d+):([0-5]?\d)(?:[.,:](\d{1,3}))?$/);
  if (match) {
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    // "2:03.4" means 400ms, not 4ms -- pad right, not left.
    const millis = match[3] ? Number(match[3].padEnd(3, "0")) / 1000 : 0;
    return minutes * 60 + seconds + millis;
  }

  const plain = Number(text.replace(",", "."));
  return Number.isFinite(plain) && plain > 0 ? plain : null;
}