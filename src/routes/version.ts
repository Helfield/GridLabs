import { Hono } from "hono";

/**
 * Which build is running, so "did my deploy land" is one curl rather than a
 * trip to the Railway dashboard.
 *
 * Lives in its own module with no imports from the app on purpose:
 * src/index.ts runs ensureSchema() and startBot() at module scope, so
 * anything that pulls it in connects to the live database.
 *
 * Railway sets both git variables on services connected to the repo. When
 * they're absent (a local `bun run dev`) the fields say so instead of
 * guessing -- an unknown commit here is honest, a wrong one is worse than
 * no endpoint at all.
 */
export const versionRoutes = new Hono();

// Module load is close enough to process start: this file is imported by
// src/index.ts, which is the entrypoint, so nothing runs before it.
const BOOTED_AT = new Date().toISOString();

versionRoutes.get("/", (c) => {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? "";
  c.header("Cache-Control", "no-store");
  return c.json({
    commit: sha ? sha.slice(0, 7) : "unknown",
    branch: process.env.RAILWAY_GIT_BRANCH ?? "unknown",
    bootedAt: BOOTED_AT,
  });
});
