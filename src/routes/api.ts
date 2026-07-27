import { Hono } from "hono";
import { db } from "../db/client";
import { users, sessions, referenceLaps } from "../db/schema";
import { eq } from "drizzle-orm";
import { getAvailableReferenceLaps, getReferenceLapForDownload } from "../db/queries";

type ApiVariables = { apiUserId: number };
export const apiRoutes = new Hono<{ Variables: ApiVariables }>();

// Every route here authenticates via "Authorization: Bearer <api_token>"
// instead of the session cookie -- the local Python app isn't a browser.
apiRoutes.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) {
    return c.json({ error: "Missing API token. Send it as: Authorization: Bearer <token>" }, 401);
  }
  const user = await db.query.users.findFirst({ where: eq(users.apiToken, token) });
  if (!user) {
    return c.json({ error: "Invalid API token." }, 401);
  }
  c.set("apiUserId", user.id);
  await next();
});

// Who am I? Used by the desktop app to confirm a token works and show
// who it's signed in as, instead of silently accepting a bad paste.
apiRoutes.get("/me", async (c) => {
  const userId = c.get("apiUserId");
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return c.json({ error: "Account not found." }, 404);
  return c.json({ id: user.id, name: user.name, role: user.role });
});

// Upload a completed session (one lap's summary).
apiRoutes.post("/sessions", async (c) => {
  const userId = c.get("apiUserId");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.track !== "string" || typeof body.car !== "string") {
    return c.json({ error: "Expected JSON body with at least: track, car" }, 400);
  }
  const [created] = await db
    .insert(sessions)
    .values({
      userId,
      track: body.track,
      car: body.car,
      referenceLapId: typeof body.referenceLapId === "number" ? body.referenceLapId : null,
      lapTimeSeconds: typeof body.lapTimeSeconds === "number" ? body.lapTimeSeconds : null,
      sector1Seconds: typeof body.sector1Seconds === "number" ? body.sector1Seconds : null,
      sector2Seconds: typeof body.sector2Seconds === "number" ? body.sector2Seconds : null,
      sector3Seconds: typeof body.sector3Seconds === "number" ? body.sector3Seconds : null,
      // Optional -- older builds of the desktop app don't send it, and a
      // lap summary is still worth storing without the telemetry.
      data: body.data ?? null,
    })
    .returning({ id: sessions.id });
  return c.json({ id: created.id }, 201);
});

// Upload a reference lap (the full per-bin JSON the local app already
// produces via ReferenceLap.save()).
apiRoutes.post("/reference-laps", async (c) => {
  const userId = c.get("apiUserId");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.track !== "string" || typeof body.car !== "string" || typeof body.label !== "string" || !body.data) {
    return c.json({ error: "Expected JSON body with at least: track, car, label, data" }, 400);
  }
  const [created] = await db
    .insert(referenceLaps)
    .values({
      ownerId: userId,
      track: body.track,
      car: body.car,
      label: body.label,
      data: body.data,
      lapTimeSeconds: typeof body.lapTimeSeconds === "number" ? body.lapTimeSeconds : null,
      isPublic: body.isPublic === true,
    })
    .returning({ id: referenceLaps.id });
  return c.json({ id: created.id }, 201);
});

// List every reference lap this account can drive against -- their own
// plus every global/public one a coach has uploaded. Lightweight: no
// per-bin data here, just enough to show a picker (track, car, label,
// lap time). The local app calls this on startup / when the driver
// changes track, then calls GET /reference-laps/:id for the one they pick.
apiRoutes.get("/reference-laps", async (c) => {
  const userId = c.get("apiUserId");
  const laps = await getAvailableReferenceLaps(userId);
  return c.json(laps);
});

// Full reference lap, including the per-bin telemetry data, for the local
// app to load once a driver has picked one from the list above. Returns
// 404 for both "doesn't exist" and "exists but isn't yours/public" --
// deliberately the same response for both, so this endpoint can't be used
// to probe which lap ids exist.
apiRoutes.get("/reference-laps/:id", async (c) => {
  const userId = c.get("apiUserId");
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) {
    return c.json({ error: "Invalid reference lap id." }, 400);
  }
  const lap = await getReferenceLapForDownload(id, userId);
  if (!lap) {
    return c.json({ error: "Reference lap not found." }, 404);
  }
  return c.json(lap);
});