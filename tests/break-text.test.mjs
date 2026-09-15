// The word BREAK that plays with the shatter: its timeline, its size, the crack
// that splits it, and Foundry's own "+(Break)" being quietened while it shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings } from "./foundry.mjs";

const {
  breakTextFrame, breakTextSize, crackMask, quietCoreBreakText,
  BREAK_TEXT_SIZE_MIN, BREAK_TEXT_SIZE_MAX, calloutSize
} = panel;

/* ------------------------------ the timeline --------------------------- */

test("the word slams down, landing at full size on impact and not before", () => {
  const start = breakTextFrame(0);
  assert.equal(start.scale, 1.9);
  assert.equal(start.alpha, 0);
  const falling = breakTextFrame(0.07);
  assert.ok(falling.scale > 1 && falling.scale < 1.9, `mid-fall scale ${falling.scale}`);
  assert.equal(breakTextFrame(0.14).scale, 1);
  // The fall has to end where the landing begins, or the word pops in size
  // at the exact moment it hits.
  assert.ok(Math.abs(breakTextFrame(0.1399).scale - 1) < 0.01,
    `jumps from ${breakTextFrame(0.1399).scale} to 1 on landing`);
});

test("it cracks, shudders and turns red only once it has landed", () => {
  const falling = breakTextFrame(0.1);
  assert.equal(falling.split, 0);
  assert.equal(falling.tint, 0);
  assert.equal(falling.shake, 0);
  const landed = breakTextFrame(0.5);
  assert.equal(landed.split, 1);
  assert.equal(landed.tint, 1);
});

test("the shudder dies away within a fifth of the timeline", () => {
  for (let i = 0; i <= 100; i++) {
    const p = i / 100;
    const { shake } = breakTextFrame(p);
    assert.ok(Math.abs(shake) <= 1, `shake ${shake} at ${p}`);
    if (p >= 0.34) assert.equal(shake, 0, `still shaking at ${p}`);
  }
});

test("it holds long enough to read, then rises and fades to nothing", () => {
  const holding = breakTextFrame(0.45);
  assert.equal(holding.alpha, 1);
  assert.equal(holding.rise, 0);
  const end = breakTextFrame(1);
  assert.equal(end.alpha, 0);
  assert.equal(end.rise, 1);
  let last = 2;
  for (let i = 62; i <= 100; i++) {
    const { alpha } = breakTextFrame(i / 100);
    assert.ok(alpha <= last, `alpha rose again at ${i / 100}`);
    last = alpha;
  }
});

test("photosensitive mode drops the slam, the shudder, the split and the flash", () => {
  for (let i = 0; i <= 20; i++) {
    const frame = breakTextFrame(i / 20, { gentle: true });
    assert.equal(frame.scale, 1);
    assert.equal(frame.shake, 0);
    assert.equal(frame.split, 0);
    assert.equal(frame.tint, 1, "already red, no white-hot flash");
  }
  assert.equal(breakTextFrame(0, { gentle: true }).alpha, 0);
  assert.equal(breakTextFrame(1, { gentle: true }).alpha, 0);
  assert.equal(breakTextFrame(1, { gentle: true }).rise, 0.5);
});

/* ------------------------------ size and crack ------------------------- */

test("the word is readable on a small token and bounded over a huge one", () => {
  assert.equal(breakTextSize(10), BREAK_TEXT_SIZE_MIN);
  assert.equal(breakTextSize(50), 60);
  assert.equal(breakTextSize(500), BREAK_TEXT_SIZE_MAX);
});

test("on any token the word is bigger than a Charm callout", () => {
  // The table asked for both bigger; a Break is still the bigger event.
  for (const radius of [10, 25, 50, 75, 100, 200, 500]) {
    assert.ok(breakTextSize(radius) > calloutSize(radius), `radius ${radius}`);
  }
});

test("the two halves meet exactly along the crack, and each reaches past its edge", () => {
  const left = crackMask(-1, 100, 40);
  const right = crackMask(1, 100, 40);
  assert.equal(left.length, 12);
  assert.deepEqual(left.slice(0, 8), right.slice(0, 8), "the halves share the crack");
  for (let i = 8; i < 12; i += 2) {
    assert.ok(left[i] <= -50, "the left half reaches past the word's left edge");
    assert.ok(right[i] >= 50, "the right half reaches past the word's right edge");
  }
  assert.ok([...left, ...right].every(Number.isFinite));
});

/* --------------------------- Foundry's own text ------------------------ */

test("Foundry's +(Break) is skipped for Break alone, as it lands, while the effect shows", () => {
  const calls = [];
  class Effect {
    constructor(statuses) { this.statuses = new Set(statuses); }
    _displayScrollingStatus(enabled) { calls.push([[...this.statuses], enabled]); }
  }
  CONFIG.ActiveEffect = { documentClass: Effect };
  try {
    assert.equal(quietCoreBreakText(), true);
    assert.equal(quietCoreBreakText(), false, "wrapping twice would stack");

    new Effect(["break"])._displayScrollingStatus(true);   // BREAK text says it
    new Effect(["break"])._displayScrollingStatus(false);  // "-(Break)" still shows
    new Effect(["prone"])._displayScrollingStatus(true);   // other statuses untouched
    settings.set("essence-poise-break.breakEffect", false);
    new Effect(["break"])._displayScrollingStatus(true);   // effect off: Foundry's is all there is

    assert.deepEqual(calls, [
      [["break"], false],
      [["prone"], true],
      [["break"], true]
    ]);
  } finally {
    settings.set("essence-poise-break.breakEffect", true);
    delete CONFIG.ActiveEffect;
  }
});

test("a Foundry without that method is left alone", () => {
  CONFIG.ActiveEffect = { documentClass: class {} };
  try {
    assert.equal(quietCoreBreakText(), false);
  } finally {
    delete CONFIG.ActiveEffect;
  }
});
