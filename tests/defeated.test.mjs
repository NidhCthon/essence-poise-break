// The DEFEATED finisher: what sets it off, that it plays once per token, the
// word's motion, and that the slowed world and drained screen always recover.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings, wait } from "./foundry.mjs";

const {
  defeatStatuses, isDefeatEffect, defeatEffectTokens, defeatCombatantTokens,
  firstDefeat, defeatedAt, defeatTextFrame, slowMotion, drainScreen, playDefeat,
  DEFEAT_REPEAT, DEFEAT_SLOW_SPEED, DEFEAT_DURATION
} = panel;

const effect = (statuses, tokens = []) => ({
  statuses: new Set(statuses),
  parent: { getActiveTokens: () => tokens }
});
const seen = (id = "tok") => ({ id, isVisible: true, destroyed: false });

/* ------------------------------ triggers ------------------------------ */

test("the system's Incapacitated and Foundry's defeated status both take a character out", () => {
  CONFIG.specialStatusEffects = { DEFEATED: "dead" };
  assert.deepEqual(defeatStatuses(), ["incapacitated", "dead"]);
  assert.equal(isDefeatEffect(effect(["incapacitated"])), true);
  assert.equal(isDefeatEffect(effect(["dead"])), true);
  assert.equal(isDefeatEffect(effect(["break"])), false);
  assert.equal(isDefeatEffect(effect([])), false);
  assert.equal(isDefeatEffect({ statuses: ["incapacitated"] }), true, "statuses as a plain array");
});

test("a world that renames Foundry's defeated status is followed", () => {
  CONFIG.specialStatusEffects = { DEFEATED: "slain" };
  assert.equal(isDefeatEffect(effect(["slain"])), true);
  CONFIG.specialStatusEffects = { DEFEATED: "dead" };
});

test("it plays only on tokens this player can see", () => {
  const hidden = { id: "hidden", isVisible: false, destroyed: false };
  const gone = { id: "gone", isVisible: true, destroyed: true };
  const tokens = defeatEffectTokens(effect(["incapacitated"], [seen("a"), hidden, gone]));
  assert.deepEqual(tokens.map((t) => t.id), ["a"]);
});

test("the combat tracker's defeated toggle plays it, and only switching it on", () => {
  const combatant = { token: { object: seen("c") } };
  assert.deepEqual(defeatCombatantTokens(combatant, { defeated: true }).map((t) => t.id), ["c"]);
  assert.deepEqual(defeatCombatantTokens(combatant, { defeated: false }), []);
  assert.deepEqual(defeatCombatantTokens(combatant, { initiative: 12 }), []);
  assert.deepEqual(defeatCombatantTokens({ token: null }, { defeated: true }), []);
});

test("with the setting off nothing plays", () => {
  settings.set("essence-poise-break.defeatedFinisher", false);
  assert.deepEqual(defeatEffectTokens(effect(["incapacitated"], [seen()])), []);
  assert.deepEqual(defeatCombatantTokens({ token: { object: seen() } }, { defeated: true }), []);
  settings.set("essence-poise-break.defeatedFinisher", true);
});

test("marked out two ways at once, a token plays it once, and again after a while", () => {
  defeatedAt.clear();
  const token = seen("twice");
  assert.equal(firstDefeat(token, 1000), true);
  assert.equal(firstDefeat(token, 1500), false, "the tracker toggle and the skull played it twice");
  assert.equal(firstDefeat(seen("other"), 1500), true, "another token is not held up");
  assert.equal(firstDefeat(token, 1000 + DEFEAT_REPEAT), true);
  assert.equal(firstDefeat({}, 0), false);
});

/* ------------------------------ the word ------------------------------ */

test("the word falls from over twice its size and lands at full size", () => {
  const start = defeatTextFrame(0);
  assert.ok(start.scale > 2);
  assert.equal(defeatTextFrame(0.12).scale, 1);
  assert.equal(defeatTextFrame(0.5).scale, 1);
  // Falling speeds up: the second half of the fall covers more than the first.
  const first = defeatTextFrame(0).scale - defeatTextFrame(0.06).scale;
  const second = defeatTextFrame(0.06).scale - defeatTextFrame(0.1199).scale;
  assert.ok(second > first);
});

test("it cools to ash, sinks as it goes, and ends invisible", () => {
  assert.equal(defeatTextFrame(0.5).tint, 1);
  assert.equal(defeatTextFrame(0.5).sink, 0);
  assert.ok(defeatTextFrame(0.9).sink > 0);
  assert.equal(defeatTextFrame(1).alpha, 0);
  assert.equal(defeatTextFrame(0.5).alpha, 1);
});

test("photosensitive mode only fades it in and out", () => {
  for (const t of [0, 0.1, 0.5, 0.9]) {
    const frame = defeatTextFrame(t, { gentle: true });
    assert.equal(frame.scale, 1);
    assert.equal(frame.shake, 0);
  }
  assert.equal(defeatTextFrame(1, { gentle: true }).alpha, 0);
});

/* ------------------------- the world and screen ------------------------- */

test("the world slows, then runs at full speed again", async () => {
  const ticker = { speed: 1 };
  assert.equal(slowMotion({ board: { app: { ticker } }, duration: 10 }), true);
  assert.equal(ticker.speed, DEFEAT_SLOW_SPEED);
  await wait(30);
  assert.equal(ticker.speed, 1);
});

test("a world already slowed, or sped up since, is left alone", async () => {
  const slowed = { speed: 0.5 };
  assert.equal(slowMotion({ board: { app: { ticker: slowed } }, duration: 10 }), false);
  assert.equal(slowed.speed, 0.5);
  const ticker = { speed: 1 };
  slowMotion({ board: { app: { ticker } }, duration: 10 });
  ticker.speed = 2;
  await wait(30);
  assert.equal(ticker.speed, 2, "put back over something else's speed");
});

test("the screen drains and the vignette closes in, then both lift", async () => {
  const view = { dataset: {} };
  const added = [];
  const doc = {
    body: { append: (el) => added.push(el) },
    createElement: () => ({
      attrs: {}, removed: false,
      setAttribute(k, v) { this.attrs[k] = v; },
      remove() { this.removed = true; }
    })
  };
  const { vignette } = drainScreen({ board: { app: { view } }, doc, duration: 10 });
  assert.equal(view.dataset.epbDefeat, "true");
  assert.equal(vignette.className, "epb-defeat-vignette");
  assert.equal(added.length, 1);
  await wait(30);
  assert.equal(view.dataset.epbDefeat, undefined);
  assert.equal(vignette.removed, true);
});

/* ------------------------------ the canvas ------------------------------ */

class FakeContainer {
  constructor() {
    this.children = [];
    this.destroyed = false;
    this.alpha = 1;
    this.zIndex = 0;
    this.position = { x: 0, y: 0, set: (x, y) => { this.position.x = x; this.position.y = y; } };
    this.scale = { x: 1, y: 1, set: (x, y = x) => { this.scale.x = x; this.scale.y = y; } };
  }
  addChild(child) { this.children.push(child); child.parent = this; return child; }
  destroy() { this.destroyed = true; }
}

class FakeText extends FakeContainer {
  constructor(text, style) {
    super();
    Object.assign(this, { text, style, tint: 0xFFFFFF });
    this.anchor = { set() {} };
  }
}

test("the word is drawn at the token, above the tokens, and cleared when it ends", async () => {
  const ticks = [];
  const ticker = { speed: 1, add: (fn) => ticks.push(fn), remove: (fn) => ticks.splice(ticks.indexOf(fn), 1) };
  globalThis.PIXI = {
    Container: FakeContainer, Text: FakeText,
    TextStyle: class { constructor(o) { Object.assign(this, o); } }
  };
  globalThis.CONFIG.Canvas = { groups: { interface: { zIndexScrollingText: 1100 } } };
  const view = { dataset: {} };
  globalThis.canvas = { interface: new FakeContainer(), app: { ticker, view } };
  globalThis.document = undefined;

  const played = playDefeat({ id: "wolf", center: { x: 400, y: 300 }, w: 100, h: 100 });
  const [effect] = canvas.interface.children;
  assert.ok(effect, "nothing was drawn");
  assert.ok(effect.zIndex > 200, "under the token layer, each token's void mesh erases it");
  assert.deepEqual([effect.position.x, effect.position.y], [400, 300]);
  assert.equal(effect.children[0].children[0].text, "DEFEATED");
  assert.equal(ticker.speed, DEFEAT_SLOW_SPEED, "the world did not slow");
  assert.equal(view.dataset.epbDefeat, "true", "the screen did not drain");
  assert.equal(ticks.length, 1);

  await played;
  assert.equal(effect.destroyed, true);
  assert.equal(ticks.length, 0, "its tick was left on the ticker");
  assert.equal(ticker.speed, 1);
  assert.equal(view.dataset.epbDefeat, undefined);
  assert.ok(DEFEAT_DURATION >= 2000, "a finisher should hold long enough to read");
});
