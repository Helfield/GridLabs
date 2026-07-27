import { Hono } from "hono";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import {
  getUserById,
  getTrackSummaries,
  getPublicLapsForTrack,
  getReferenceLapForDownload,
} from "../db/queries";
import { trackLibraryPage, trackDetailPage } from "../views/library-pages";

export const libraryRoutes = new Hono<{ Variables: AppVariables }>();

// Everyone signed in can browse and download -- this is the whole point
// of the library: students get laps without anyone sending them files.
libraryRoutes.use("*", requireAuth);

libraryRoutes.get("/", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  const tracks = await getTrackSummaries();
  return c.html(trackLibraryPage(user, tracks));
});

libraryRoutes.get("/track/:track", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");
  const track = decodeURIComponent(c.req.param("track"));
  const { laps, sampleData } = await getPublicLapsForTrack(track);
  return c.html(trackDetailPage(user, track, laps, sampleData));
});

// Serve the lap as a .json file the app's "Import lap" button accepts.
//
// The stored blob is whatever was uploaded, which for older exports is
// just {samples:...} with no track/car/lap time inside. The app refuses
// to import a lap that doesn't say where it's from, so those fields get
// filled in here from the database row -- the download is always a
// complete, importable file even when the original upload wasn't.
libraryRoutes.get("/lap/:id/download", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.text("Invalid lap id.", 400);

  const lap = await getReferenceLapForDownload(id, userId);
  if (!lap) return c.text("Reference lap not found.", 404);

  const data = (lap.data ?? {}) as Record<string, unknown>;
  const payload = {
    ...data,
    track: (data.track as string) || lap.track,
    car: (data.car as string) || lap.car,
    lap_time_s: (data.lap_time_s as number) ?? lap.lapTimeSeconds ?? null,
  };

  const safe = `${lap.track}-${lap.label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "reference-lap";

  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", `attachment; filename="${safe}.json"`);
  return c.body(JSON.stringify(payload, null, 2));
});