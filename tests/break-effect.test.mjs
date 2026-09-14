// The Break effect: which tokens shatter, and the shatter's geometry. The
// drawing itself needs a canvas, so what is tested here is everything that
// decides what gets drawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings, fireOnce, wait } from "./foundry.mjs";

const {
  isBreakEffect, breakEffectTokens, seedFor, shardLayout, shatterFrame,
  mixColor, shardColor, CRACK_LIGHT, drawShatter, BREAK_COLORS
} = panel;

const breakStatus = (parent) => ({ statuses: new Set(["break"]), parent });
const token = (id, { visible = true, destroyed = false } = {}) => ({ id, isVisible: visible, destroyed });
const actorWith = (tokens) => ({ documentName: "Actor", getActiveTokens: () => tokens });

/* ------------------------------ who shatters --------------------------- */

test("only the Break status counts", () => {
  assert.equal(isBreakEffect({ statuses: new Set(["break"]) }), true);
  assert.equal(isBreakEffect({ statuses: ["break"] }), true, "the plain-data form");
  assert.equal(isBreakEffect({ statuses: new Set(["prone"]) }), false);
  assert.equal(isBreakEffect({ name: "Break", statuses: new Set() }), false,
    "a name alone is not the status");
});

test("it plays on every visible token of the actor that Broke", () => {
  const shown = breakEffectTokens(breakStatus(actorWith([token("a"), token("b")])));
  assert.deepEqual(shown.map((t) => t.id), ["a", "b"]);
});

test("a token this player cannot see never gives its position away", () => {
  // Token#isVisible is false for a token hidden from players and for one
  // outside this player's vision. A shatter drawn there would reveal it.
  const shown = breakEffectTokens(breakStatus(actorWith([
    token("seen"), token("hidden", { visible: false }), token("gone", { destroyed: true })
  ])));
  assert.deepEqual(shown.map((t) => t.id), ["seen"]);
});

test("an effect on an item, or with no parent, plays nowhere", () => {
  assert.deepEqual(breakEffectTokens(breakStatus({ documentName: "Item" })), []);
  assert.deepEqual(breakEffectTokens(breakStatus(null)), []);
});

test("a player who turned it off sees nothing", () => {
  settings.set("essence-poise-break.breakEffect", false);
  try {
    assert.deepEqual(breakEffectTokens(breakStatus(actorWith([token("a")]))), []);
  } finally {
    settings.set("essence-poise-break.breakEffect", true);
  }
});

/* ------------------------------- the shape ----------------------------- */

test("a token shatters the same way every time, and differently from another", () => {
  assert.deepEqual(shardLayout(14, seedFor("token-a")), shardLayout(14, seedFor("token-a")));
  assert.notDeepEqual(shardLayout(14, seedFor("token-a")), shardLayout(14, seedFor("token-b")));
});

test("the shards ring the whole token", () => {
  const layout = shardLayout(14, seedFor("x"));
  assert.equal(layout.length, 14);
  const quadrants = new Set(layout.map((s) => Math.floor(
    (((s.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2))));
  assert.equal(quadrants.size, 4, "every quarter of the circle has a shard");
});

test("the shatter starts whole, bursts outward, and ends invisible", () => {
  const start = shatterFrame(0);
  const end = shatterFrame(1);
  assert.equal(start.burst, 0);
  assert.equal(start.alpha, 1);
  assert.equal(start.tint, 0);
  assert.equal(start.ringAlpha, 0, "the ring arrives with the crack, not before it");
  assert.equal(end.burst, 1);
  assert.equal(end.alpha, 0);
  assert.equal(end.ringAlpha, 0);
  let last = -1;
  for (let i = 0; i <= 20; i++) {
    const { burst } = shatterFrame(i / 20);
    assert.ok(burst >= last, `burst went backwards at ${i / 20}`);
    last = burst;
  }
  assert.deepEqual(shatterFrame(-1), start, "clamped below");
  assert.deepEqual(shatterFrame(2), end, "clamped above");
});

test("colours blend channel by channel", () => {
  assert.equal(mixColor(0x000000, 0xffffff, 0.5), 0x808080);
  assert.equal(mixColor(BREAK_COLORS.jade, BREAK_COLORS.break, 0), BREAK_COLORS.jade);
  assert.equal(mixColor(BREAK_COLORS.jade, BREAK_COLORS.break, 1), BREAK_COLORS.break);
});

test("a shard turns from jade to red through a flash of light, not through mud", () => {
  const { jade, break: red } = BREAK_COLORS;
  assert.equal(shardColor(0, jade, red), jade);
  assert.equal(shardColor(0.5, jade, red), CRACK_LIGHT);
  assert.equal(shardColor(1, jade, red), red);
  // A straight blend is a dull grey-brown halfway; the crack must be bright.
  const sum = (c) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
  assert.ok(sum(mixColor(jade, red, 0.5)) < 500, "the straight blend really is dull");
  assert.ok(sum(shardColor(0.5, jade, red)) > 700);
});

test("each frame draws one ring and one four-point shard per layout entry", () => {
  const calls = [];
  const graphics = new Proxy({}, {
    get: (_, name) => (...args) => { calls.push([name, args]); return graphics; }
  });
  drawShatter(graphics, shardLayout(14, seedFor("x")), shatterFrame(0.5), 50,
    BREAK_COLORS.jade, BREAK_COLORS.break);

  assert.equal(calls[0][0], "clear", "each frame starts from a clean slate");
  assert.equal(calls.filter(([name]) => name === "drawCircle").length, 1);
  const shards = calls.filter(([name]) => name === "drawPolygon");
  assert.equal(shards.length, 14);
  for (const [, [points]] of shards) {
    assert.equal(points.length, 8);
    assert.ok(points.every(Number.isFinite));
  }
});

test("the last frame draws no ring at all", () => {
  const calls = [];
  const graphics = new Proxy({}, {
    get: (_, name) => (...args) => { calls.push(name); return graphics; }
  });
  drawShatter(graphics, [], shatterFrame(1), 50, BREAK_COLORS.jade, BREAK_COLORS.break);
  assert.deepEqual(calls, ["clear"]);
});

/* ------------------------------- the wiring ---------------------------- */

test("with no canvas, a Break status is ignored quietly", async () => {
  await fireOnce("ready");
  assert.doesNotThrow(() =>
    Hooks.callAll("createActiveEffect", breakStatus(actorWith([token("a")]))));
  await wait(10);
});
