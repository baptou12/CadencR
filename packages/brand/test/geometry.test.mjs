import assert from "node:assert/strict";
import test from "node:test";
import { ringDots } from "../src/geometry.mjs";

test("places twelve dots by default", () => {
  assert.equal(ringDots().length, 12);
});

test("starts at 12 o'clock", () => {
  const [first] = ringDots();
  assert.deepEqual(first, { cx: 24, cy: 9.5 });
});

test("spaces dots evenly on the r14.5 ring", () => {
  for (const { cx, cy } of ringDots()) {
    const radius = Math.hypot(cx - 24, cy - 24);
    assert.ok(Math.abs(radius - 14.5) < 0.01, `dot at ${cx},${cy} is ${radius} from center`);
  }
});

// The rounding is baked into every committed SVG and PNG in the repo, so a
// change here silently rewrites every brand asset.
test("rounds coordinates to two decimals", () => {
  for (const { cx, cy } of ringDots()) {
    assert.equal(cx, +cx.toFixed(2));
    assert.equal(cy, +cy.toFixed(2));
  }
});

test("honours a custom count, radius, and center", () => {
  const dots = ringDots(4, 10, 50);
  assert.equal(dots.length, 4);
  assert.deepEqual(dots[0], { cx: 50, cy: 40 });
  assert.deepEqual(dots[1], { cx: 60, cy: 50 });
});
