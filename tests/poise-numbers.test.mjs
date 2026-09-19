// Poise damage numbers: working out what an update did to Poise from the value
// this client last saw, what the number says and how it moves, and where it is
// drawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings } from "./foundry.mjs";

const {
  poiseSeen, rememberPoise, rememberCanvasPoise, changesPoise, poiseChange,
  poiseNumberText, poiseNumberColor, poiseNumberFrame, poiseNumberSize, poiseNumberTokens,
  playPoiseNumber, poiseAfterUpdate, BREAK_COLORS,
  POISE_NUMBER_SIZE_MIN, POISE_NUMBER_SIZE_MAX, POISE_NUMBER_DURATION
} = panel;

function actor(uuid, value, tokens = []) {
  return { uuid, system: { poise: { value, max: 5 } }, getActiveTokens: () => tokens };
}
const seen = (id = "tok") => ({ id, isVisible: true, destroyed: false });

/* ------------------------------ the change ------------------------------ */

test("an update is read as setting Poise whether nested or flattened", () => {
  assert.equal(changesPoise({ system: { poise: { value: 2 } } }), true);
  assert.equal(changesPoise({ "system.poise.value": 2 }), true);
  assert.equal(changesPoise({ system: { poise: { max: 6 } } }), false);
  assert.equal(changesPoise({ system: { power: { value: 3 } } }), false);
  assert.equal(changesPoise(null), false);
});

test("a withering hit shows the Poise it took", () => {
  poiseSeen.clear();
  const target = actor("Actor.a", 5);
  rememberPoise(target);
  target.system.poise.value = 3;
  assert.deepEqual(poiseChange(target, { system: { poise: { value: 3 } } }), { amount: -2, broke: false });
});

test("the hit that takes the last of it Breaks them", () => {
  poiseSeen.clear();
  const target = actor("Actor.b", 2);
  rememberPoise(target);
  target.system.poise.value = 0;
  assert.deepEqual(poiseChange(target, { "system.poise.value": 0 }), { amount: -2, broke: true });
});

test("Poise coming back in Break is a gain, not a Break", () => {
  poiseSeen.clear();
  const target = actor("Actor.c", 0);
  rememberPoise(target);
  target.system.poise.value = 2;
  assert.deepEqual(poiseChange(target, { system: { poise: { value: 2 } } }), { amount: 2, broke: false });
});

test("nothing shows for no change, an unrelated update, or a Poise never seen", () => {
  poiseSeen.clear();
  const target = actor("Actor.d", 4);
  assert.equal(poiseChange(target, { system: { poise: { value: 4 } } }), null, "never seen before");
  assert.equal(poiseSeen.get("Actor.d"), 4, "but now it is remembered");
  assert.equal(poiseChange(target, { system: { poise: { value: 4 } } }), null, "the same value again");
  target.system.poise.value = 1;
  assert.equal(poiseChange(target, { system: { power: { value: 2 } } }), null, "Poise was not in the update");
});

test("each change is measured from the one before", () => {
  poiseSeen.clear();
  const target = actor("Actor.e", 5);
  rememberPoise(target);
  target.system.poise.value = 4;
  assert.equal(poiseChange(target, { system: { poise: { value: 4 } } }).amount, -1);
  target.system.poise.value = 1;
  assert.equal(poiseChange(target, { system: { poise: { value: 1 } } }).amount, -3);
});

test("everything on the canvas is remembered as it is drawn", () => {
  poiseSeen.clear();
  rememberCanvasPoise({ tokens: { placeables: [{ actor: actor("Actor.f", 3) }, { actor: null }, {}] } });
  assert.equal(poiseSeen.get("Actor.f"), 3);
  assert.equal(poiseSeen.size, 1);
});

/* ------------------------------ the number ------------------------------ */

test("a loss reads as a minus, a gain as a plus", () => {
  assert.equal(poiseNumberText({ amount: -3 }), "-3");
  assert.equal(poiseNumberText({ amount: 2 }), "+2");
});

test("jade while standing, break red on the Breaking hit, paler for a gain", () => {
  assert.equal(poiseNumberColor({ amount: -2, broke: false }), BREAK_COLORS.jade);
  assert.equal(poiseNumberColor({ amount: -2, broke: true }), BREAK_COLORS.break);
  const gain = poiseNumberColor({ amount: 2, broke: false });
  assert.notEqual(gain, BREAK_COLORS.jade);
  assert.ok((gain & 0xff) > (BREAK_COLORS.jade & 0xff), "a gain should be lighter");
});

test("it pops out oversized, lands, rises, and ends invisible", () => {
  assert.ok(poiseNumberFrame(0).scale > 1.5);
  assert.equal(poiseNumberFrame(0.3).scale, 1);
  assert.ok(poiseNumberFrame(0.9).rise > poiseNumberFrame(0.3).rise);
  assert.equal(poiseNumberFrame(1).alpha, 0);
  assert.equal(poiseNumberFrame(0.3).alpha, 1);
});

test("the Breaking hit lands bigger and shudders", () => {
  assert.ok(poiseNumberFrame(0.3, { broke: true }).scale > poiseNumberFrame(0.3).scale);
  assert.ok(Math.abs(poiseNumberFrame(0.15, { broke: true }).shake) > 0);
  assert.equal(poiseNumberFrame(0.15).shake, 0);
});

test("photosensitive mode only fades it", () => {
  for (const t of [0, 0.1, 0.5]) {
    const frame = poiseNumberFrame(t, { gentle: true, broke: true });
    assert.equal(frame.scale, 1);
    assert.equal(frame.shake, 0);
  }
});

test("it is sized well over a Charm callout, and bounded", () => {
  assert.equal(poiseNumberSize(10), POISE_NUMBER_SIZE_MIN);
  assert.equal(poiseNumberSize(1000), POISE_NUMBER_SIZE_MAX);
  assert.equal(poiseNumberSize(50), 65);
});

/* ------------------------------ who sees it ----------------------------- */

test("it shows on the tokens this player can see, unless turned off", () => {
  const hidden = { id: "h", isVisible: false, destroyed: false };
  assert.deepEqual(poiseNumberTokens(actor("Actor.g", 1, [seen("a"), hidden])).map((t) => t.id), ["a"]);
  settings.set("essence-poise-break.poiseNumbers", false);
  assert.deepEqual(poiseNumberTokens(actor("Actor.g", 1, [seen("a")])), []);
  settings.set("essence-poise-break.poiseNumbers", true);
});

test("an update plays the number on each token, and a failed one is caught", async () => {
  poiseSeen.clear();
  const target = actor("Actor.h", 5, [seen("one"), seen("two")]);
  rememberPoise(target);
  target.system.poise.value = 2;
  const played = [];
  poiseAfterUpdate(target, { system: { poise: { value: 2 } } }, {
    play: (token, change) => { played.push([token.id, change.amount]); }
  });
  assert.deepEqual(played, [["one", -3], ["two", -3]]);

  target.system.poise.value = 1;
  assert.doesNotThrow(() => poiseAfterUpdate(target, { system: { poise: { value: 1 } } }, {
    play: () => Promise.reject(new Error("no canvas"))
  }));
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

test("the number is drawn above the tokens, to the right of centre, then cleared", async () => {
  const animations = [];
  globalThis.PIXI = {
    Container: FakeContainer, Text: FakeText,
    TextStyle: class { constructor(o) { Object.assign(this, o); } }
  };
  foundry.canvas = {
    animation: {
      CanvasAnimation: {
        animate(attributes, options) {
          animations.push(options);
          for (const a of attributes) a.parent[a.attribute] = 0.3;
          options.ontick?.();
          return Promise.resolve(true);
        }
      }
    }
  };
  globalThis.CONFIG.Canvas = { groups: { interface: { zIndexScrollingText: 1100 } } };
  globalThis.canvas = { interface: new FakeContainer() };

  await playPoiseNumber({ id: "wolf", center: { x: 400, y: 300 }, w: 100, h: 100 }, { amount: -3, broke: true });
  const [effect] = canvas.interface.children;
  assert.ok(effect.zIndex > 200, "under the token layer, each token's void mesh erases it");
  assert.ok(effect.position.x > 400, "it should sit right of centre, clear of the BREAK word");
  const [number, label] = effect.children[0].children;
  assert.equal(number.text, "-3");
  assert.equal(label.text, "POISE");
  assert.equal(number.tint, BREAK_COLORS.break);
  assert.equal(animations[0].duration, POISE_NUMBER_DURATION);
  assert.equal(effect.destroyed, true);
});
