// Hit-stop and screen shake: the map freezes on a stark frame, then jolts, and
// the cut-in follows - and the map is never left frozen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings, wait } from "./foundry.mjs";

const {
  hitStop, playDecisive, impactAllowed, shouldShowDecisive, shouldShowCutIn,
  HIT_STOP, SHAKE_DURATION
} = panel;

function board({ started = true } = {}) {
  const calls = [];
  const ticker = {
    started,
    stop() { calls.push("stop"); this.started = false; },
    start() { calls.push("start"); this.started = true; }
  };
  const view = { dataset: {} };
  return { app: { view, ticker }, calls, view, ticker };
}

test("the map freezes on the stark frame, lets go after HIT_STOP, then shakes", async () => {
  const b = board();
  const done = hitStop({ board: b, duration: 20 });
  assert.equal(b.view.dataset.epbImpact, "stop");
  assert.deepEqual(b.calls, ["stop"]);
  assert.equal(await done, true);
  assert.deepEqual(b.calls, ["stop", "start"]);
  assert.equal(b.view.dataset.epbImpact, "shake");
  await wait(SHAKE_DURATION + 30);
  assert.equal(b.view.dataset.epbImpact, undefined, "the shake was left on the board");
  assert.ok(HIT_STOP > 0 && HIT_STOP < 300, "a hit-stop is a split second");
});

test("a ticker that was already stopped is not started by the impact", async () => {
  const b = board({ started: false });
  await hitStop({ board: b, duration: 5 });
  assert.deepEqual(b.calls, []);
  assert.equal(b.ticker.started, false);
});

test("a ticker that fails to restart still ends the freeze and shakes", async () => {
  const b = board();
  b.ticker.start = () => { throw new Error("canvas gone"); };
  assert.equal(await hitStop({ board: b, duration: 5 }), true);
  assert.equal(b.view.dataset.epbImpact, "shake");
});

test("a second impact during the first does not stack", async () => {
  const b = board();
  const first = hitStop({ board: b, duration: 20 });
  assert.equal(await hitStop({ board: b, duration: 20 }), false);
  await first;
  assert.deepEqual(b.calls, ["stop", "start"]);
});

test("with no board there is nothing to freeze", async () => {
  assert.equal(await hitStop({ board: null }), false);
  assert.equal(await hitStop({ board: { app: {} } }), false);
});

test("the cut-in plays after the freeze, not before", async () => {
  const order = [];
  let release;
  const stop = () => { order.push("freeze"); return new Promise((r) => { release = r; }); };
  const played = playDecisive({ name: "Rising Tide" }, {
    impact: () => true, stop, cutIn: () => order.push("cut-in"), showCut: () => true
  });
  await wait(5);
  assert.deepEqual(order, ["freeze"]);
  release(true);
  await played;
  assert.deepEqual(order, ["freeze", "cut-in"]);
});

test("with the impact off the cut-in plays at once; with the cut-in off only the impact plays", async () => {
  const order = [];
  await playDecisive({ name: "X" }, {
    impact: () => false, stop: () => order.push("freeze"), cutIn: () => order.push("cut-in"), showCut: () => true
  });
  assert.deepEqual(order, ["cut-in"]);
  order.length = 0;
  await playDecisive({ name: "X" }, {
    impact: () => true, stop: () => { order.push("freeze"); return true; },
    cutIn: () => order.push("cut-in"), showCut: () => false
  });
  assert.deepEqual(order, ["freeze"]);
});

test("a freeze that fails still lets the cut-in play", async () => {
  const order = [];
  await playDecisive({ name: "X" }, {
    impact: () => true, stop: () => Promise.reject(new Error("no canvas")),
    cutIn: () => order.push("cut-in"), showCut: () => true
  });
  assert.deepEqual(order, ["cut-in"]);
});

test("photosensitive mode, reduced motion, or the setting off leave the impact out", () => {
  assert.equal(impactAllowed(), true);
  settings.set("core.photosensitiveMode", true);
  assert.equal(impactAllowed(), false);
  settings.delete("core.photosensitiveMode");
  globalThis.matchMedia = () => ({ matches: true });
  assert.equal(impactAllowed(), false);
  delete globalThis.matchMedia;
  settings.set("essence-poise-break.hitImpact", false);
  assert.equal(impactAllowed(), false);
  settings.set("essence-poise-break.hitImpact", true);
});

test("a decisive hit is shown if either the cut-in or the impact is on", () => {
  const payload = { name: "X", actorUuid: null };
  assert.equal(shouldShowDecisive(payload), true);
  settings.set("essence-poise-break.decisiveCutIn", false);
  assert.equal(shouldShowCutIn(payload), false);
  assert.equal(shouldShowDecisive(payload), true, "the impact alone should still play");
  settings.set("essence-poise-break.hitImpact", false);
  assert.equal(shouldShowDecisive(payload), false);
  settings.set("essence-poise-break.decisiveCutIn", true);
  settings.set("essence-poise-break.hitImpact", true);
});
