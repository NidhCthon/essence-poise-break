// playBreakEffect() against a fake canvas: where the effect is drawn, what it
// animates, and that it cleans up.
//
// The first BREAK text shipped invisible. The effect was added to the interface
// group at zIndex 0, below the token layer, and each token draws a void mesh
// that erases interface content under it inside its outline: the word, sitting
// inside the token, vanished. Nothing offline could see that, because neither
// the tests nor the preview have tokens. This file pins the one fact that
// decides it - the effect's layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel } from "./foundry.mjs";

const { playBreakEffect, BREAK_TEXT_DURATION } = panel;

/** Foundry's token layer sits at this zIndex in the interface group. */
const TOKEN_LAYER_Z = 200;

/* ---------------------------- a fake canvas ---------------------------- */

class FakeContainer {
  constructor() {
    this.children = [];
    this.destroyed = false;
    this.alpha = 1;
    this.rotation = 0;
    this.zIndex = 0;
    this.position = { x: 0, y: 0, set: (x, y = x) => { this.position.x = x; this.position.y = y; } };
    this.scale = { x: 1, y: 1, set: (v) => { this.scale.x = v; this.scale.y = v; } };
  }
  addChild(child) { this.children.push(child); child.parent = this; return child; }
  destroy() { this.destroyed = true; }
}

class FakeGraphics extends FakeContainer {
  clear() { return this; }
  lineStyle() { return this; }
  drawCircle() { return this; }
  beginFill() { return this; }
  drawPolygon() { return this; }
  endFill() { return this; }
}

class FakeText extends FakeContainer {
  constructor(text, style) {
    super();
    Object.assign(this, { text, style, width: 70, height: 30, tint: 0xFFFFFF, mask: null });
    this.anchor = { set() {} };
  }
}

const animations = [];

function freshCanvas({ photosensitive = false, levels = true, onAnimate = null } = {}) {
  animations.length = 0;
  globalThis.PIXI = {
    Container: FakeContainer,
    Graphics: FakeGraphics,
    Text: FakeText,
    TextStyle: class { constructor(options) { Object.assign(this, options); } }
  };
  foundry.canvas = {
    animation: {
      CanvasAnimation: {
        animate(attributes, options) {
          animations.push(options);
          onAnimate?.(options);
          for (const a of attributes) a.parent[a.attribute] = a.to;
          options.ontick?.();
          return Promise.resolve(true);
        }
      }
    }
  };
  globalThis.canvas = { interface: new FakeContainer(), photosensitiveMode: photosensitive };
  CONFIG.Canvas = levels ? { groups: { interface: { zIndexScrollingText: 1100 } } } : undefined;
  return globalThis.canvas;
}

const wolf = { id: "wolf", center: { x: 400, y: 300 }, w: 100, h: 100, hasDynamicRing: false };

/* -------------------------------- tests -------------------------------- */

test("the effect is drawn above the token layer, at Foundry's floating-text level", async () => {
  const board = freshCanvas();
  await playBreakEffect(wolf);
  const [effect] = board.interface.children;
  assert.ok(effect, "nothing was added to the interface group");
  assert.equal(effect.zIndex, 1100);
  assert.ok(effect.zIndex > TOKEN_LAYER_Z,
    "under the token layer, each token's void mesh erases the effect inside its outline");
});

test("without Foundry's configured level, it still goes above the tokens", async () => {
  const board = freshCanvas({ levels: false });
  await playBreakEffect(wolf);
  assert.ok(board.interface.children[0].zIndex > TOKEN_LAYER_Z);
});

test("the word is drawn on top of the shards, and both are centred on the token", async () => {
  const board = freshCanvas();
  await playBreakEffect(wolf);
  const [effect] = board.interface.children;
  assert.equal(effect.position.x, 400);
  assert.equal(effect.position.y, 300);
  assert.ok(effect.children[0] instanceof FakeGraphics, "shards first");
  assert.ok(effect.children[1].children.length === 2, "then the word, in two halves");
});

test("the shatter and the word both animate, and the word lasts longer", async () => {
  freshCanvas();
  await playBreakEffect(wolf);
  const durations = animations.map((a) => a.duration).sort((a, b) => a - b);
  assert.deepEqual(durations, [950, BREAK_TEXT_DURATION]);
  assert.ok(animations.every((a) => String(a.name).includes("wolf")),
    "named per token, so a second Break on the same token replaces the first");
});

test("photosensitive mode plays both more slowly", async () => {
  freshCanvas({ photosensitive: true });
  await playBreakEffect(wolf);
  const durations = animations.map((a) => a.duration).sort((a, b) => a - b);
  assert.deepEqual(durations, [1600, 2200]);
});

test("the drawing is destroyed once both animations finish", async () => {
  const board = freshCanvas();
  await playBreakEffect(wolf);
  assert.equal(board.interface.children[0].destroyed, true);
});

test("a canvas torn down mid-effect is left alone rather than thrown at", async () => {
  const board = freshCanvas({
    onAnimate: (options) => { options.context.destroyed = true; }
  });
  await assert.doesNotReject(playBreakEffect(wolf));
  assert.equal(board.interface.children[0].destroyed, true);
});
