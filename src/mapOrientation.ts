/**
 * Which way up a track's map is drawn.
 *
 * The sim reports positions in its own world axes, and a track's layout
 * is authored at whatever angle suited its modeller -- so drawing x across
 * and z up shows the right shape at an arbitrary rotation. Le Mans
 * Ultimate's own track maps are turned to a fixed angle per circuit, and a
 * driver comparing ours against the in-game one expects the same way up.
 *
 * Whole quarter turns anticlockwise, per track. Add a track only after
 * comparing with the in-game map -- the count can't be worked out from
 * the telemetry. Keep in step with lmu_coach/map_orientation.py in the
 * desktop app, which draws the same maps.
 */
const QUARTER_TURNS: Record<string, number> = {
  "Monza Curva Grande Circuit": 1,
  "Autodromo Nazionale Monza": 1,
};

export function quarterTurns(track: string | null | undefined): number {
  return QUARTER_TURNS[track ?? ""] ?? 0;
}

/** Turn a world point anticlockwise as drawn (x right, z up). */
export function rotatePoint(x: number, z: number, turns: number): [number, number] {
  let rx = x, rz = z;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) [rx, rz] = [-rz, rx];
  return [rx, rz];
}
