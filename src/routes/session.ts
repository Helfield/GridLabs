import { Hono } from "hono";
import type { AppVariables } from "../index";
import { requireAuth } from "./auth";
import { getUserById, getSessionWithTrackHistory, getReferenceForComparison } from "../db/queries";
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

  return c.html(
    sessionDetailPage(user, result.session, result.sameTrack, backHref, backLabel, reference),
  );
});