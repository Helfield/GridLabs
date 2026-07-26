import { Hono } from "hono";
import { db } from "../db/client";
import { users, sessions, referenceLaps } from "../db/schema";
import { eq } from "drizzle-orm";

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
