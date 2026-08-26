import { Hono } from "hono";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import { getUserById, getSessionWithTrackHistory, getReferenceForComparison } from "../db/queries";
import { promoteSessionToReference } from "../db/promotions";
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