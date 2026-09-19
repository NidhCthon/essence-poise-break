// The Bonfire aura: which tokens burn, what a frame draws, and how the auras
// follow the actors - kindling, dying away, moving with their tokens - against
// a fake canvas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings } from "./foundry.mjs";

const {
  auraLevel, auraFlameLayout, auraFade, drawAura, auras, wantedAuras, syncAuras,
  tickAuras, clearAuras, AURA_FLAMES, AURA_FLAMES_ICONIC, AURA_REACH_ICONIC, AURA_FADE
} = panel;

/* ------------------------------- levels ------------------------------- */

const actorAt = (level, color = "#1FA34A") => ({
  system: { anima: { level }, details: { animacolor: color } }
});

test("an aura burns at bonfire and iconic, and nowhere below", () => {
  for (const level of ["", "dim", "glowing", "burning", undefined, "blazing"]) {
    assert.equal(auraLevel(actorAt(level)), null, String(level));
  }
  assert.equal(auraLevel(actorAt("bonfire")), "bonfire");
  assert.equal(auraLevel(actorAt("iconic")), "iconic");
  assert.equal(auraLevel(null), null);
});

/* ------------------------------- layout ------------------------------- */

test("a token's flames are laid out the same each time, and go all the way round", () => {
  const a = auraFlameLayout(AURA_FLAMES, 42);
  assert.deepEqual(a, auraFlameLayout(AURA_FLAMES, 42));
  assert.notDeepEqual(a, auraFlameLayout(AURA_FLAMES, 43));
  assert.equal(a.length, AURA_FLAMES);
  const quarters = new Set(a.map((f) => Math.floor(((f.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (Math.PI / 2))));
  assert.equal(quarters.size, 4, "some side of the token has no flames");
});

test("it kindles and dies away over AURA_FADE seconds", () => {
  assert.equal(auraFade(10, { born: 10 }), 0);
  assert.ok(Math.abs(auraFade(10 + AURA_FADE / 2, { born: 10 }) - 0.5) < 1e-9);
  assert.equal(auraFade(20, { born: 10 }), 1);
  assert.equal(auraFade(20 + AURA_FADE, { born: 10, dying: 20 }), 0);
  assert.ok(auraFade(20 + AURA_FADE / 4, { born: 10, dying: 20 }) > 0.7);
});

/* ------------------------------- drawing ------------------------------ */

class Recorder {
  constructor() { this.reset(); }
  reset() { this.circles = []; this.polygons = []; this.fills = []; }
  clear() { this.reset(); return this; }
  lineStyle() { return this; }
  beginFill(color, alpha) { this.fills.push(alpha); return this; }
  endFill() { return this; }
  drawCircle(x, y, r) { this.circles.push({ x, y, r }); return this; }
  drawPolygon(points) { this.polygons.push(points); return this; }
}

const radius = 50;

test("a frame draws a halo and a flame for each in the layout", () => {
  const g = new Recorder();
  const layout = auraFlameLayout(AURA_FLAMES, 7);
  drawAura(g, layout, { time: 3 }, radius, 0x1FA34A);
  assert.ok(g.circles.length >= 3, "no halo");
  assert.equal(g.polygons.length, AURA_FLAMES * 2, "each flame is a sheath and a core");
  assert.ok(g.fills.every((a) => a > 0 && a <= 1));
});

// Flames leaning up the sides may lap over the rim, never further in.
test("the flames start at the token's edge, so its art stays clear", () => {
  const g = new Recorder();
  for (let time = 0; time < 6; time += 0.37) {
    drawAura(g, auraFlameLayout(AURA_FLAMES_ICONIC, 9), { time, level: "iconic" }, radius, 0xFF6A1A);
    for (const points of g.polygons) {
      for (let i = 0; i < points.length; i += 2) {
        assert.ok(Math.hypot(points[i], points[i + 1]) >= radius * 0.8,
          `a flame reaches ${Math.hypot(points[i], points[i + 1]).toFixed(1)} into a ${radius} radius token`);
      }
    }
    for (const c of g.circles) assert.ok(c.r >= radius);
  }
});

test("flames over the top of the token reach higher than those underneath", () => {
  const g = new Recorder();
  const layout = [
    { angle: -Math.PI / 2, length: 1, width: 0.3, speed: 2, phase: 0 },
    { angle: Math.PI / 2, length: 1, width: 0.3, speed: 2, phase: 0 }
  ];
  drawAura(g, layout, { time: 0 }, radius, 0xFF6A1A);
  const reach = (points) => Math.max(...points.filter((_, i) => i % 2 === 1).map((y) => Math.abs(y)));
  assert.ok(reach(g.polygons[0]) > reach(g.polygons[2]) + radius * 0.2);
});

test("an iconic aura reaches further than a bonfire one", () => {
  const layout = [{ angle: -Math.PI / 2, length: 1, width: 0.3, speed: 2, phase: 0 }];
  const top = (level) => {
    const g = new Recorder();
    drawAura(g, layout, { time: 0, level }, radius, 0xFF6A1A);
    return Math.min(...g.polygons[0].filter((_, i) => i % 2 === 1));
  };
  assert.ok(top("iconic") < top("bonfire"));
  assert.ok(-top("iconic") <= radius * (1 + AURA_REACH_ICONIC) + 1);
});

test("photosensitive mode keeps only the halo, and nothing is drawn faded out", () => {
  const g = new Recorder();
  drawAura(g, auraFlameLayout(AURA_FLAMES, 7), { time: 3, gentle: true }, radius, 0x1FA34A);
  assert.equal(g.polygons.length, 0);
  assert.ok(g.circles.length > 0);
  drawAura(g, auraFlameLayout(AURA_FLAMES, 7), { time: 3, fade: 0 }, radius, 0x1FA34A);
  assert.equal(g.circles.length + g.polygons.length, 0);
});

/* ------------------------------ the canvas ----------------------------- */

class FakeContainer {
  constructor() {
    this.children = [];
    this.destroyed = false;
    this.visible = true;
    this.zIndex = 0;
    this.position = { x: 0, y: 0, set: (x, y) => { this.position.x = x; this.position.y = y; } };
  }
  addChild(child) { this.children.push(child); child.parent = this; return child; }
  destroy() { this.destroyed = true; }
}

class FakeGraphics extends FakeContainer {
  constructor() { super(); this.shapes = 0; }
  clear() { this.shapes = 0; return this; }
  lineStyle() { return this; }
  beginFill() { return this; }
  endFill() { return this; }
  drawCircle() { this.shapes += 1; return this; }
  drawPolygon() { this.shapes += 1; return this; }
}

function token(id, level, { x = 100, y = 200, visible = true, color = "#1FA34A" } = {}) {
  return { id, x, y, w: 100, h: 100, isVisible: visible, destroyed: false, actor: actorAt(level, color) };
}

function freshCanvas(placeables) {
  clearAuras();
  settings.set("essence-poise-break.bonfireAura", true);
  const ticks = [];
  globalThis.PIXI = { Container: FakeContainer, Graphics: FakeGraphics, BLEND_MODES: { ADD: 1 } };
  globalThis.CONFIG.Canvas = { groups: { interface: { zIndexScrollingText: 1100 } } };
  globalThis.canvas = {
    interface: new FakeContainer(),
    tokens: { placeables },
    app: {
      ticker: {
        add: (fn) => ticks.push(fn),
        remove: (fn) => ticks.splice(ticks.indexOf(fn), 1)
      }
    }
  };
  return { board: globalThis.canvas, ticks };
}

test("only a burning token gets an aura, above the tokens and under the flare", () => {
  const { board, ticks } = freshCanvas([token("hot", "bonfire"), token("cold", "burning")]);
  syncAuras({ now: 0 });
  assert.deepEqual([...auras.keys()], ["hot"]);
  const [effect] = board.interface.children;
  assert.ok(effect.zIndex > 200 && effect.zIndex < 1100, `zIndex ${effect.zIndex}`);
  assert.equal(effect.children[0].blendMode, 1);
  assert.equal(ticks.length, 1, "no ticker to draw it");
});

test("each tick follows the token and draws it", () => {
  const hot = token("hot", "bonfire");
  const { board } = freshCanvas([hot]);
  syncAuras({ now: 0 });
  tickAuras(1, board);
  const [effect] = board.interface.children;
  assert.deepEqual([effect.position.x, effect.position.y], [150, 250]);
  assert.ok(effect.children[0].shapes > 0);
  hot.x = 500;
  tickAuras(1.1, board);
  assert.equal(effect.position.x, 550);
});

test("a token the player cannot see shows no aura", () => {
  const { board } = freshCanvas([token("hidden", "iconic", { visible: false })]);
  syncAuras({ now: 0 });
  tickAuras(1, board);
  assert.equal(board.interface.children[0].visible, false);
});

test("when the anima falls it dies away, then goes, and the ticker stops", () => {
  const hot = token("hot", "bonfire");
  const { board, ticks } = freshCanvas([hot]);
  syncAuras({ now: 0 });
  hot.actor = actorAt("burning");
  syncAuras({ now: 5 });
  tickAuras(5 + AURA_FADE / 2, board);
  assert.equal(auras.size, 1, "it went out at once");
  tickAuras(5 + AURA_FADE + 0.01, board);
  assert.equal(auras.size, 0);
  assert.equal(board.interface.children[0].destroyed, true);
  assert.equal(ticks.length, 0, "the ticker kept running");
});

test("rising again before it has gone keeps the same aura", () => {
  const hot = token("hot", "bonfire");
  freshCanvas([hot]);
  syncAuras({ now: 0 });
  const first = auras.get("hot");
  hot.actor = actorAt("burning");
  syncAuras({ now: 5 });
  hot.actor = actorAt("iconic");
  syncAuras({ now: 5.2 });
  assert.equal(auras.get("hot"), first);
  assert.equal(first.dying, null);
  assert.equal(first.level, "iconic");
  assert.equal(first.layout.length, AURA_FLAMES_ICONIC);
});

test("a new anima colour is picked up", () => {
  const hot = token("hot", "bonfire");
  freshCanvas([hot]);
  syncAuras({ now: 0 });
  hot.actor = actorAt("bonfire", "#3366FF");
  syncAuras({ now: 1 });
  assert.equal(auras.get("hot").color, 0x3366FF);
});

test("with the setting off nothing burns", () => {
  freshCanvas([token("hot", "bonfire")]);
  settings.set("essence-poise-break.bonfireAura", false);
  assert.equal(wantedAuras(canvas.tokens.placeables).size, 0);
  syncAuras({ now: 0 });
  assert.equal(auras.size, 0);
  settings.set("essence-poise-break.bonfireAura", true);
});

test("a deleted token's aura goes with it", () => {
  const hot = token("hot", "bonfire");
  const { board } = freshCanvas([hot]);
  syncAuras({ now: 0 });
  hot.destroyed = true;
  tickAuras(1, board);
  assert.equal(auras.size, 0);
});

test("tearing the canvas down removes every aura and stops the ticker", () => {
  const { board, ticks } = freshCanvas([token("a", "bonfire"), token("b", "iconic")]);
  syncAuras({ now: 0 });
  assert.equal(auras.size, 2);
  clearAuras();
  assert.equal(auras.size, 0);
  assert.ok(board.interface.children.every((c) => c.destroyed));
  assert.equal(ticks.length, 0);
});
