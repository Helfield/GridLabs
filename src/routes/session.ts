import { Hono } from "hono";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import { getUserById, getSessionWithTrackHistory, getReferenceForComparison, setSessionExcluded } from "../db/queries";
import { promoteSessionToReference, promoteBestLaps } from "../db/promotions";
import { syncTrackLeaderboard } from "../discord/leaderboard";
import { sessionDetailPage } from "../views/session-pages";

export const sessionRoutes = new Hono<{ Variables: AppVariables }>();

sessionRoutes.use("*", requireAuth);

sessionRoutes.get("/:id", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user) return c.redirect("/login");

  const sessionId = Number(c.req.param("id"));
  if (!Number.isInteger(sessionId)) return c.text("Not found.", 404);

  const result = await getSessionWithTrackHistory(sessionId);
  if (!result) return c.text("Session not found.", 404);

  // A driver can open their own laps; a coach can open anyone's.
  const isOwner = result.session.userId === user.id;
  if (!isOwner && user.role !== "coach") {
    return c.text("Session not found.", 404);
  }

  const backHref = isOwner ? "/student" : `/coach/driver/${result.session.userId}`;
  const backLabel = isOwner ? "My driving" : "Back to driver";

  // The lap to compare against on the traces. Null is fine -- the page
  // just draws the driver's own lap on its own.
  const reference = await getReferenceForComparison(result.session.track, result.session.car);

  // Only a coach looking at someone ELSE's lap gets the promote button --
  // there's no case where promoting your own lap through this path makes
  // sense (the "Global reference laps" upload form covers that).
  const canPromote = !isOwner && user.role === "coach";
  const justPromoted = c.req.query("promoted") === "1";
  // Only coaches can disqualify or restore a lap -- their own included.
  const canModerate = user.role === "coach";
  const moderation = c.req.query("dq") === "1" ? "disqualified" : c.req.query("dq") === "0" ? "restored" : null;

  return c.html(
    sessionDetailPage(
      user,
      result.session,
      result.sameTrack,
      backHref,
      backLabel,
      reference,
      canPromote,
      justPromoted,
      canModerate,
      moderation,
    ),
  );
});

// Coach-only: publish this exact lap as a public reference lap right
// now, regardless of whether it beats anything currently live. This is
// a deliberate manual override of the automatic beat-the-reference
// logic in db/promotions.ts -- a coach who's looked at the breakdown
// and decided it's worth sharing, not the system's own judgement.
sessionRoutes.post("/:id/promote", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user || user.role !== "coach") return c.text("Not found.", 404);

  const sessionId = Number(c.req.param("id"));
  if (!Number.isInteger(sessionId)) return c.text("Not found.", 404);

  const result = await promoteSessionToReference(sessionId);
  if (!result.ok) {
    return c.text(result.reason, 400);
  }

  return c.redirect(`/session/${sessionId}?promoted=1`);
});

// Coach-only: disqualify a lap. It leaves every leaderboard (and the
// Discord board for the track), and if it had been published as a
// reference lap that comes down and the next-best valid lap takes over.
// Reversible with /restore below.
sessionRoutes.post("/:id/exclude", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user || user.role !== "coach") return c.text("Not found.", 404);

  const sessionId = Number(c.req.param("id"));
  if (!Number.isInteger(sessionId)) return c.text("Not found.", 404);

  const body = await c.req.parseBody();
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";

  const changed = await setSessionExcluded(sessionId, true, reason || null);
  if (!changed) return c.text("Session not found.", 404);
  await afterModeration(changed.track);
  return c.redirect(`/session/${sessionId}?dq=1`);
});

sessionRoutes.post("/:id/restore", async (c) => {
  const user = await getUserById(c.get("userId"));
  if (!user || user.role !== "coach") return c.text("Not found.", 404);

  const sessionId = Number(c.req.param("id"));
  if (!Number.isInteger(sessionId)) return c.text("Not found.", 404);

  const changed = await setSessionExcluded(sessionId, false, null);
  if (!changed) return c.text("Session not found.", 404);
  await afterModeration(changed.track);
  return c.redirect(`/session/${sessionId}?dq=0`);
});

/**
 * Bring everything that depends on the lap's status up to date for its
 * track. The reference laps are settled before the redirect so the page
 * that loads next is already right; the Discord board is refreshed in
 * the background -- a slow or unreachable Discord must never make a
 * disqualification look like it failed.
 */
async function afterModeration(track: string): Promise<void> {
  try {
    await promoteBestLaps(track);
  } catch (err) {
    console.error(`Reference-lap refresh after moderation failed for ${track}:`, err);
  }
  // A coach's correction is not a beaten record, so no announcement.
  syncTrackLeaderboard(track, { announce: false }).catch((err) => {
    console.error(`Discord leaderboard sync failed for ${track}:`, err);
  });
}
