// Contract tests against the fixtures in ../../gridlabs-fixtures -- the
// desktop app (Python) asserts the same cases in
// lmu-coach/tests/test_contract.py. If the two implementations of this
// shared logic ever drift, one side's test fails here or there.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { quarterTurns, rotatePoint } from "../src/mapOrientation";
import { hasCutSegment } from "../src/db/promotions";

const FIXTURES = join(import.meta.dir, "..", "..", "gridlabs-fixtures");

function fixture(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

function mismatches(cases: { label: string; got: unknown; want: unknown }[]) {
  return cases
    .filter((c) => JSON.stringify(c.got) !== JSON.stringify(c.want))
    .map((c) => `${c.label}: got ${JSON.stringify(c.got)}, want ${JSON.stringify(c.want)}`);
}

test("quarterTurns matches the shared fixture", () => {
  const orient = fixture("map-orientation.json");
  expect(
    mismatches(
      orient.quarterTurns.map((c: any) => ({
        label: `track ${JSON.stringify(c.track)}`,
        got: quarterTurns(c.track),
        want: c.turns,
      })),
    ),
  ).toEqual([]);
});

test("rotatePoint matches the shared fixture", () => {
  const orient = fixture("map-orientation.json");
  expect(
    mismatches(
      orient.rotate.map((c: any) => ({
        label: `(${c.x},${c.z}) turns ${c.turns}`,
        got: rotatePoint(c.x, c.z, c.turns),
        want: c.expected,
      })),
    ),
  ).toEqual([]);
});

test("hasCutSegment matches the shared fixture", () => {
  const lapCut = fixture("lap-cut.json");
  expect(
    mismatches(
      lapCut.cases.map((c: any) => ({
        label: c.name,
        got: hasCutSegment({ samples: c.samples }),
        want: c.expectCut,
      })),
    ),
  ).toEqual([]);
});
