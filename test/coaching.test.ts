// The paid-coaching rules, tested without a database. Same split as the league
// rules: src/db/coaching.ts reads and writes rows, src/coachingRules.ts decides.
import { test, expect } from "bun:test";
import {
  COACHING_CLASSES,
  entitlementCounts,
  GOAL_MAX,
  linkField,
  validateIntake,
  youtubeLink,
  type IntakeForm,
} from "../src/coachingRules";

const NOW = new Date("2026-11-03T12:00:00Z");

test("an entitlement with no end date never runs out", () => {
  expect(entitlementCounts({ expiresAt: null }, NOW)).toBe(true);
});

test("an entitlement runs until its end date and not past it", () => {
  expect(entitlementCounts({ expiresAt: new Date("2026-12-31T00:00:00Z") }, NOW)).toBe(true);
  expect(entitlementCounts({ expiresAt: new Date("2026-10-01T00:00:00Z") }, NOW)).toBe(false);
  // The moment it expires is not still access.
  expect(entitlementCounts({ expiresAt: NOW }, NOW)).toBe(false);
});

test("a pasted link is kept only if a browser would open it", () => {
  expect(linkField("https://imgur.com/a/9fK2xQ1")).toBe("https://imgur.com/a/9fK2xQ1");
  expect(linkField("  http://example.com/setup.png  ")).toBe("http://example.com/setup.png");
  expect(linkField("javascript:alert(1)")).toBeNull();
  expect(linkField("ftp://example.com/setup.png")).toBeNull();
  expect(linkField("setup.png")).toBeNull();
  expect(linkField("https://localhost")).toBeNull();
  expect(linkField("")).toBeNull();
  expect(linkField(null)).toBeNull();
});

test("a race video is stored as a watch URL, whatever form it was pasted in", () => {
  expect(youtubeLink("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  expect(youtubeLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120")).toBe(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  expect(youtubeLink("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("a video a coach can't watch is rejected", () => {
  // A channel and a playlist are not a race.
  expect(youtubeLink("https://www.youtube.com/@gridlabs")).toBeNull();
  expect(youtubeLink("https://www.youtube.com/playlist?list=PL1234567890")).toBeNull();
  expect(youtubeLink("https://youtube.com/watch?v=short")).toBeNull();
  expect(youtubeLink("https://vimeo.com/123456789")).toBeNull();
});

// ------------------------------------------------------------------ intake

const FILLED: IntakeForm = {
  name: "  Brent  ",
  email: "  Brent@Example.com ",
  srBand: "Silver 2",
  drBand: "Gold 1",
  experience: "3 to 5 years",
  classes: ["GT3", "LMP2"],
  goal: "Qualifying pace in the GT3 at Spa before the season starts in March",
  setupLink: "",
  video: "https://youtu.be/dQw4w9WgXcQ",
};

const ok = (over: Partial<IntakeForm> = {}) => validateIntake({ ...FILLED, ...over });

test("the intake offers the classes Le Mans Ultimate actually has", () => {
  expect(COACHING_CLASSES).toEqual(["Hypercar", "LMP2", "LMP3", "GTE", "GT3"]);
  // GT4 is scored by the league tables but isn't a class in the game, so a coach
  // would be asked to teach a car nobody can buy.
  expect(COACHING_CLASSES.includes("GT4")).toBe(false);
});

test("a complete intake is accepted, with the answers tidied", () => {
  const { intake, errors } = ok();
  expect(errors).toEqual({});
  expect(intake?.name).toBe("Brent");
  expect(intake?.email).toBe("brent@example.com");
  expect(intake?.classes).toEqual(["GT3", "LMP2"]);
  expect(intake?.video).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  // Left blank is allowed and stays blank, rather than becoming an empty string
  // that renders as a link to the page itself.
  expect(intake?.setupLink).toBeNull();
});

test("every answer a coach needs is required, by name", () => {
  const cases: Array<[string, Partial<IntakeForm>]> = [
    ["name", { name: "" }],
    ["email", { email: "brent at example.com" }],
    ["srBand", { srBand: "Silver 4" }],
    ["drBand", { drBand: "" }],
    ["experience", { experience: "since forever" }],
    ["classes", { classes: [] }],
    ["goal", { goal: "get faster" }],
    ["video", { video: "https://youtube.com/@gridlabs" }],
    ["setupLink", { setupLink: "imgur.com/9fK2xQ1" }],
  ];
  for (const [field, over] of cases) {
    const { intake, errors } = ok(over);
    expect(intake, field).toBeNull();
    expect(errors[field], field).toBeTruthy();
  }
});

test("a class the club doesn't score is not stored, and the rest survive", () => {
  const { intake, errors } = ok({ classes: ["GT3", "F1", 'LMP2"; drop table users; --'] });
  expect(intake?.classes).toEqual(["GT3"]);
  expect(errors.classes).toBeUndefined();
});

test("GT4 is refused even though it is a scoring class", () => {
  // Refusing it is the whole answer: nothing saves a profile naming a car the
  // game doesn't run, and the field says which classes can be ticked.
  const { intake, errors } = ok({ classes: ["GT4"] });
  expect(intake).toBeNull();
  expect(errors.classes).toBeTruthy();
});

test("the video is asked for as a fastest lap, not any old race", () => {
  const { errors } = ok({ video: "" });
  expect(errors.video).toContain("fastest lap");
});

test("an answer over a limit is refused, never silently cut", () => {
  // A goal trimmed by the server is a sentence the coach never reads.
  const long = ok({ goal: `Qualifying pace in the GT3. ${"x".repeat(GOAL_MAX)}` });
  expect(long.intake).toBeNull();
  expect(long.errors.goal).toBeTruthy();
});
