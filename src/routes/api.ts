import { Hono } from "hono";
import { db } from "../db/client";
import { users, sessions, referenceLaps, raceResults } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { handleEngineerRequest, handleVoiceRequest } from "../engineer";
import { createEngineerQuota } from "../db/engineerQuota";
import { isStaff } from "../db/league";
import { getAvailableReferenceLapsWithSetupFlag, getReferenceLapForDownload, getSetupForReferenceLap, saveSetup } from "../db/queries";
import { sanitiseSetup } from "../setups";
import { syncTrackLeaderboard } from "../discord/leaderboard";
import { evaluateSessionForPromotion } from "../db/promotions";

type ApiVariables = { apiUserId: number; apiUserRole: string };
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
  c.set("apiUserRole", user.role);
  await next();
});

const engineerQuota = createEngineerQuota(
  (parts, ...values) => db.execute(sql(parts, ...values)),
);

apiRoutes.post("/engineer", async (c) => {
  const result = await handleEngineerRequest(c.req.raw, c.get("apiUserId"), {
    claimQuota: engineerQuota.claim,
    releaseQuota: engineerQuota.release,
    log: (entry) => console.error("engineer failure:", entry.reason, entry.status || "", entry.code || ""),
  }, isStaff(c.get("apiUserRole")));
  return c.json(result.body, result.status);
});

// Words from one radio recording. Deliberately outside the trial allowance:
// the app asks for this before it decides whether a question needs the AI at
// all, and Windows' own recogniser is the reason free-text voice failed.
apiRoutes.post("/engineer/voice", async (c) => {
  const result = await handleVoiceRequest(c.req.raw, c.get("apiUserId"), {
    log: (entry) => console.error("voice failure:", entry.reason, entry.status || "", entry.code || ""),
  });
  return c.json(result.body, result.status);
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

  // The car setup the driver chose to share with this lap, if any (the app
  // only sends one when "share my setups" is switched on). A bad or
  // oversized one is dropped; the lap itself is stored regardless.
  const setup = sanitiseSetup(body.setup);
  if (setup) {
    await saveSetup({ ownerId: userId, sessionId: created.id, track: body.track, car: body.car, setup }).catch((err) =>
      console.error(`Saving the setup for session ${created.id} failed:`, err),
    );
  }

  // Two follow-ups, neither awaited: the app gets its 201 straight away,
  // and a failure in either is logged rather than turned into a failed
  // upload. If this lap is the fastest for its track and car class it
  // becomes that class's public reference lap; the Discord leaderboard
  // for the track is then brought up to date.
  if (typeof body.lapTimeSeconds === "number") {
    evaluateSessionForPromotion({
      id: created.id,
      userId,
      track: body.track,
      car: body.car,
      lapTimeSeconds: body.lapTimeSeconds,
      data: body.data ?? null,
    })
      .catch((err) => console.error(`Reference-lap promotion failed for session ${created.id}:`, err))
      .finally(() => {
        syncTrackLeaderboard(body.track).catch((err) => {
          console.error(`Discord leaderboard sync failed for ${body.track}:`, err);
        });
      });
  }

  return c.json({ id: created.id }, 201);
});

// Where a race finished, sent by the desktop app when the driver takes
// the flag and again when the session ends (same raceKey, fuller
// classification). Only ever used to cross-check league results.
apiRoutes.post("/race-results", async (c) => {
  const userId = c.get("apiUserId");
  const body = await c.req.json().catch(() => null);
  const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
  const place = int(body?.place);
  if (
    !body ||
    typeof body.raceKey !== "string" ||
    !body.raceKey ||
    body.raceKey.length > 64 ||
    typeof body.track !== "string" ||
    typeof body.car !== "string" ||
    place === null ||
    place < 1 ||
    place > 200
  ) {
    return c.json({ error: "Expected JSON body with at least: raceKey, track, car, place" }, 400);
  }
  // The classification is just a table of the field; keep it modest in size.
  const classification = Array.isArray(body.classification) ? body.classification.slice(0, 200) : null;
  const values = {
    userId,
    raceKey: body.raceKey,
    track: body.track,
    car: body.car,
    place,
    classPlace: int(body.classPlace),
    finishStatus: int(body.finishStatus) ?? 0,
    laps: int(body.laps),
    bestLapSeconds: typeof body.bestLap === "number" && Number.isFinite(body.bestLap) ? body.bestLap : null,
    fieldSize: int(body.fieldSize),
    classification,
    updatedAt: new Date(),
  };
  await db
    .insert(raceResults)
    .values(values)
    .onConflictDoUpdate({ target: [raceResults.userId, raceResults.raceKey], set: values });
  return c.json({ ok: true }, 201);
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

  const setup = sanitiseSetup(body.setup);
  if (setup) {
    await saveSetup({ ownerId: userId, referenceLapId: created.id, track: body.track, car: body.car, setup }).catch((err) =>
      console.error(`Saving the setup for reference lap ${created.id} failed:`, err),
    );
  }
  return c.json({ id: created.id }, 201);
});

// List every reference lap this account can drive against -- their own
// plus every global/public one a coach has uploaded. Lightweight: no
// per-bin data here, just enough to show a picker (track, car, label,
// lap time). The local app calls this on startup / when the driver
// changes track, then calls GET /reference-laps/:id for the one they pick.
apiRoutes.get("/reference-laps", async (c) => {
  const userId = c.get("apiUserId");
  const laps = await getAvailableReferenceLapsWithSetupFlag(userId);
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

// The car setup that goes with a reference lap: the exact .svm file (when
// the driver's app could read it) and the garage's setting values ("live"),
// which the app can install and apply. Same access rule as the lap itself:
// 404 for "doesn't exist", "isn't yours/public" and "has no setup" alike.
apiRoutes.get("/reference-laps/:id/setup", async (c) => {
  const userId = c.get("apiUserId");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) {
    return c.json({ error: "Invalid reference lap id." }, 400);
  }
  const lap = await getReferenceLapForDownload(id, userId);
  if (!lap) return c.json({ error: "Setup not found." }, 404);
  const setup = await getSetupForReferenceLap({ id: lap.id, sourceSessionId: lap.sourceSessionId });
  if (!setup) return c.json({ error: "Setup not found." }, 404);
  return c.json({
    name: setup.name,
    track: setup.track,
    car: setup.car,
    carModel: setup.carModel,
    trackFolder: setup.trackFolder,
    svm: setup.svm,
    live: setup.live,
    createdAt: setup.createdAt,
  });
});
