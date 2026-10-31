// The deploy check. Imports only src/routes/version, never src/index.ts --
// that module runs ensureSchema() and startBot() at load, which would put a
// test run on the production database.
import { test, expect } from "bun:test";
import { versionRoutes } from "../src/routes/version";

async function get() {
  const res = await versionRoutes.request("/");
  return { res, body: await res.json() };
}

test("/version reports the commit Railway gives it", async () => {
  process.env.RAILWAY_GIT_COMMIT_SHA = "d477bbc1c2f3a4b5d6e7f8091a2b3c4d5e6f7081";
  process.env.RAILWAY_GIT_BRANCH = "main";
  try {
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(body.commit).toBe("d477bbc");
    expect(body.branch).toBe("main");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  } finally {
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    delete process.env.RAILWAY_GIT_BRANCH;
  }
});

test("/version says unknown rather than inventing a commit", async () => {
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  delete process.env.RAILWAY_GIT_BRANCH;
  const { body } = await get();
  expect(body.commit).toBe("unknown");
  expect(body.branch).toBe("unknown");
});

test("/version reports when this process booted", async () => {
  const { body } = await get();
  const booted = new Date(body.bootedAt);
  expect(Number.isNaN(booted.getTime())).toBe(false);
  // Module load is by definition in this run, so a stale or nonsense
  // timestamp would be more than a minute away from now.
  expect(Math.abs(Date.now() - booted.getTime())).toBeLessThan(60_000);
});
