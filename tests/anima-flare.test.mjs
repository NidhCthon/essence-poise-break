// The anima flare: when it plays, who sees it, what it shows, where it is
// drawn - and that watching for it can never cancel an update to an actor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings, hooks, fireOnce } from "./foundry.mjs";

const {
  animaRank, crossesIntoFlare, iconicLine, cleanFlarePayload, animaFlarePayload,
  changesAnima, recordAnimaBefore, animaAfterUpdate, shouldShowFlare, flareFrame,
  emberLayout, flareCaptionMarkup, playAnimaFlare, receiveAnimaFlare,
  FLARE_MESSAGE, FLARE_DURATION, FLARE_DURATION_GENTLE, FLARE_EMBERS, FLARE_ICONIC_MAX,
  FLARE_HEIGHT, FLARE_WIDTH, CUT_IN_FALLBACK
} = panel;

const scene = { id: "scene" };

/** A character whose anima is at `level`, with a token on the scene. */
function hero({
  level = "bonfire", owner = true, color = "#FF6A1A",
  iconic = "A burning phoenix unfolds its wings above her. Every eye turns.",
  token = { document: { id: "tok", parent: scene } }, synthetic = null
} = {}) {
  return {
    uuid: "Actor.hero", name: "Rising Tide", hasPlayerOwner: owner,
    system: { anima: { level, iconic }, details: { animacolor: color } },
    token: synthetic,
    getActiveTokens: () => (token ? [token] : [])
  };
}

/* ------------------------------- levels ------------------------------- */

test("anima levels rank in the system's order, and anything else counts as none", () => {
  const order = ["", "dim", "glowing", "burning", "bonfire", "iconic"];
  order.forEach((level, i) => assert.equal(animaRank(level), i, level || "(none)"));
  assert.equal(animaRank(undefined), 0);
  assert.equal(animaRank("blazing"), 0);
});

test("it flares on rising into bonfire, and again on rising into iconic", () => {
  const rank = animaRank;
  assert.equal(crossesIntoFlare(rank("burning"), rank("bonfire")), true);
  assert.equal(crossesIntoFlare(rank("bonfire"), rank("iconic")), true);
  assert.equal(crossesIntoFlare(rank("glowing"), rank("iconic")), true, "the alternate anima track skips bonfire");
});

test("staying put, falling, or rising short of bonfire plays nothing", () => {
  const rank = animaRank;
  assert.equal(crossesIntoFlare(rank("bonfire"), rank("bonfire")), false);
  assert.equal(crossesIntoFlare(rank("iconic"), rank("bonfire")), false);
  assert.equal(crossesIntoFlare(rank("dim"), rank("burning")), false);
});

/* ---------------------------- iconic anima ---------------------------- */

test("the caption takes the first sentence of the iconic anima, as plain text", () => {
  assert.equal(iconicLine("A burning phoenix unfolds its wings. Every eye turns."),
    "A burning phoenix unfolds its wings.");
  assert.equal(iconicLine("<p>A <b>golden</b> sun</p>"), "A golden sun");
  assert.equal(iconicLine("   "), "");
  assert.equal(iconicLine(undefined), "");
  assert.equal(iconicLine(42), "");
});

test("a long first sentence is cut short rather than filling the screen", () => {
  const line = iconicLine("x".repeat(400));
  assert.equal(line.length, FLARE_ICONIC_MAX);
  assert.ok(line.endsWith("…"));
});

/* ------------------------------ payloads ------------------------------ */

test("a character in bonfire becomes a payload with its token and iconic anima", () => {
  assert.deepEqual(animaFlarePayload(hero()), {
    actorUuid: "Actor.hero", tokenId: "tok", sceneId: "scene", name: "Rising Tide",
    color: "#FF6A1A", level: "bonfire", iconic: "A burning phoenix unfolds its wings above her."
  });
});

test("an unlinked token's actor is found through its own token", () => {
  const payload = animaFlarePayload(hero({ token: null, synthetic: { id: "wolf", parent: scene } }));
  assert.equal(payload.tokenId, "wolf");
});

test("an antagonist's flare keeps its iconic anima text to itself", () => {
  assert.equal(animaFlarePayload(hero({ owner: false })).iconic, "");
});

test("below bonfire, or with no token to erupt from, there is no payload", () => {
  assert.equal(animaFlarePayload(hero({ level: "burning" })), null);
  assert.equal(animaFlarePayload(hero({ token: null })), null);
  assert.equal(animaFlarePayload(null), null);
});

test("a received flare is cleaned: level, token and colour checked, text made plain", () => {
  const clean = cleanFlarePayload({
    name: " Rising Tide ", tokenId: "tok", sceneId: "scene", level: "iconic",
    color: "url(x)", iconic: "<img src=x onerror=alert(1)>Sun."
  });
  assert.equal(clean.name, "Rising Tide");
  assert.equal(clean.color, CUT_IN_FALLBACK);
  assert.equal(clean.iconic, "Sun.");
  for (const bad of [
    { name: "X", tokenId: "tok", sceneId: "scene", level: "burning" },
    { name: "X", sceneId: "scene", level: "bonfire" },
    { name: "", tokenId: "tok", sceneId: "scene", level: "bonfire" },
    null
  ]) {
    assert.equal(cleanFlarePayload(bad), null, JSON.stringify(bad));
  }
});

/* ----------------------------- the update ----------------------------- */

test("an update is watched only when it touches the anima value", () => {
  assert.equal(changesAnima({ system: { anima: { value: 7 } } }), true);
  assert.equal(changesAnima({ "system.anima.value": 7 }), true);
  assert.equal(changesAnima({ system: { motes: { value: 3 } } }), false);
  assert.equal(changesAnima({ system: { anima: { iconic: "x" } } }), false);
  assert.equal(changesAnima(null), false);
});

function spies() {
  const sent = [];
  const played = [];
  return { sent, played, options: { emit: (m) => sent.push(m), play: (p) => played.push(p), show: () => true } };
}

test("raising anima into bonfire plays the flare here and sends it to everyone", () => {
  const actor = hero({ level: "burning" });
  const { sent, played, options } = spies();
  recordAnimaBefore(actor, { system: { anima: { value: 7 } } }, game.user.id);
  actor.system.anima.level = "bonfire";
  const payload = animaAfterUpdate(actor, game.user.id, options);
  assert.equal(payload.level, "bonfire");
  assert.deepEqual(sent, [{ type: FLARE_MESSAGE, payload }]);
  assert.deepEqual(played, [payload]);
});

test("an update that leaves the level where it was plays nothing", () => {
  const actor = hero({ level: "bonfire" });
  const { sent, played, options } = spies();
  recordAnimaBefore(actor, { system: { anima: { value: 8 } } }, game.user.id);
  assert.equal(animaAfterUpdate(actor, game.user.id, options), null);
  assert.equal(sent.length + played.length, 0);
});

test("only the client that made the change sends it, so the table sees it once", () => {
  const actor = hero({ level: "burning" });
  const { sent, options } = spies();
  assert.equal(recordAnimaBefore(actor, { system: { anima: { value: 7 } } }, "someone-else"), false);
  actor.system.anima.level = "bonfire";
  assert.equal(animaAfterUpdate(actor, "someone-else", options), null);
  assert.equal(sent.length, 0);
});

test("a change is judged once: a later update with nothing recorded plays nothing", () => {
  const actor = hero({ level: "burning" });
  const { sent, options } = spies();
  recordAnimaBefore(actor, { system: { anima: { value: 7 } } }, game.user.id);
  actor.system.anima.level = "bonfire";
  animaAfterUpdate(actor, game.user.id, options);
  actor.system.anima.level = "iconic";
  assert.equal(animaAfterUpdate(actor, game.user.id, options), null, "no anima change was recorded");
  assert.equal(sent.length, 1);
});

test("a failure in the flare never escapes into the update", () => {
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const actor = hero({ level: "burning" });
    const played = [];
    recordAnimaBefore(actor, { system: { anima: { value: 7 } } }, game.user.id);
    actor.system.anima.level = "bonfire";
    assert.doesNotThrow(() => animaAfterUpdate(actor, game.user.id, {
      emit: () => { throw new Error("socket down"); }, play: (p) => played.push(p), show: () => true
    }));
    assert.equal(played.length, 1, "a failed send still plays here");

    recordAnimaBefore(actor, { system: { anima: { value: 10 } } }, game.user.id);
    actor.system.anima.level = "iconic";
    assert.doesNotThrow(() => animaAfterUpdate(actor, game.user.id, {
      emit: () => {}, play: () => { throw new Error("no canvas"); }, show: () => true
    }));
  } finally {
    console.warn = quiet;
  }
});

test("watching for the flare can never cancel an actor update", async () => {
  await fireOnce("ready");
  const before = hooks.on.get("preUpdateActor") ?? [];
  assert.ok(before.length > 0, "nothing watches preUpdateActor");
  const actor = hero({ level: "burning" });
  for (const handler of before) {
    // Foundry calls these with Hooks.call, where returning false cancels.
    assert.equal(handler(actor, { system: { anima: { value: 7 } } }, {}, game.user.id), undefined);
    assert.equal(handler(actor, { name: "Renamed" }, {}, game.user.id), undefined);
  }
  assert.ok((hooks.on.get("updateActor") ?? []).length > 0);
});

/* --------------------------- who sees it --------------------------- */

function viewing({ sceneId = "scene", tokens = {} } = {}) {
  globalThis.canvas = { scene: { id: sceneId }, tokens: { get: (id) => tokens[id] } };
}

test("it plays for a token this player can see, on the scene they are viewing", () => {
  const payload = animaFlarePayload(hero());
  viewing({ tokens: { tok: { isVisible: true } } });
  assert.equal(shouldShowFlare(payload), true);
  viewing({ tokens: { tok: { isVisible: false } } });
  assert.equal(shouldShowFlare(payload), false, "a hidden token gives nothing away");
  viewing({ sceneId: "elsewhere", tokens: { tok: { isVisible: true } } });
  assert.equal(shouldShowFlare(payload), false, "it belongs to a place on a map");
});

test("a player who turned the flare off sees none", () => {
  viewing({ tokens: { tok: { isVisible: true } } });
  settings.set("essence-poise-break.animaFlare", false);
  try {
    assert.equal(shouldShowFlare(animaFlarePayload(hero())), false);
  } finally {
    settings.set("essence-poise-break.animaFlare", true);
  }
});

test("a received flare is cleaned before it is shown; other messages are ignored", () => {
  const played = [];
  const options = { play: (p) => played.push(p), show: () => true };
  receiveAnimaFlare({ type: "decisiveCutIn", payload: { name: "X" } }, options);
  receiveAnimaFlare({ type: FLARE_MESSAGE, payload: { name: "X", level: "burning" } }, options);
  receiveAnimaFlare(null, options);
  assert.equal(played.length, 0);
  receiveAnimaFlare({ type: FLARE_MESSAGE, payload: animaFlarePayload(hero()) }, options);
  assert.equal(played.length, 1);
});

/* ----------------------------- the drawing ----------------------------- */

test("the flare starts dark, is fully risen within a quarter, and ends invisible", () => {
  assert.equal(flareFrame(0).alpha, 0);
  assert.ok(flareFrame(0.25).rise >= 0.999);
  assert.equal(flareFrame(1).alpha, 0);
  assert.equal(flareFrame(0.7).ringAlpha, 0, "the ring is gone well before the column");
});

test("photosensitive mode: no ring, never full brightness, no flicker", () => {
  for (const t of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
    const frame = flareFrame(t, { gentle: true });
    assert.equal(frame.ringAlpha, 0);
    assert.equal(frame.flicker, 1);
    assert.ok(frame.alpha <= 0.6);
  }
});

test("the column towers over the token rather than standing on it like a candle", () => {
  // The table asked for it bigger twice over; these are in token radii.
  assert.ok(FLARE_HEIGHT >= 10, "shorter than ten radii reads as a candle");
  assert.ok(FLARE_WIDTH >= 0.8 && FLARE_WIDTH <= 1.2, "as wide as the token, near enough");
});

test("embers are laid out the same way every time for the same token", () => {
  const a = emberLayout(FLARE_EMBERS, 1234);
  assert.equal(a.length, FLARE_EMBERS);
  assert.deepEqual(a, emberLayout(FLARE_EMBERS, 1234));
  assert.notDeepEqual(a, emberLayout(FLARE_EMBERS, 99));
});

test("the caption escapes names and iconic text, and names the level", () => {
  const html = flareCaptionMarkup({
    name: "<b>Tide</b>", level: "iconic", color: "#FF6A1A", iconic: "<script>x()</script>"
  });
  assert.ok(html.includes(">Iconic<"));
  assert.ok(!html.includes("<b>Tide"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("--epb-flare-color: #FF6A1A"));
});

test("with no iconic text there is no empty line, and the gentle version is marked", () => {
  const html = flareCaptionMarkup({ name: "Tide", level: "bonfire", color: "red" }, { gentle: true });
  assert.ok(!html.includes("epb-flare-iconic"));
  assert.ok(html.includes(">Bonfire<"));
  assert.ok(html.includes(`--epb-flare-color: ${CUT_IN_FALLBACK}`));
  assert.ok(html.includes(`data-gentle="true"`));
});

/* ---------------------------- a fake canvas ---------------------------- */

class FakeContainer {
  constructor() {
    this.children = [];
    this.destroyed = false;
    this.zIndex = 0;
    this.position = { x: 0, y: 0, set: (x, y = x) => { this.position.x = x; this.position.y = y; } };
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
  drawRect() { this.shapes += 1; return this; }
  drawCircle() { this.shapes += 1; return this; }
}

const animations = [];

function freshCanvas({ photosensitive = false, onAnimate = null } = {}) {
  animations.length = 0;
  globalThis.PIXI = { Container: FakeContainer, Graphics: FakeGraphics, BLEND_MODES: { ADD: 1 } };
  foundry.canvas = {
    animation: {
      CanvasAnimation: {
        animate(attributes, options) {
          animations.push(options);
          onAnimate?.(options);
          for (const a of attributes) a.parent[a.attribute] = 0.3;
          options.ontick?.();
          return Promise.resolve(true);
        }
      }
    }
  };
  globalThis.canvas = { interface: new FakeContainer(), photosensitiveMode: photosensitive };
  CONFIG.Canvas = { groups: { interface: { zIndexScrollingText: 1100 } } };
  return globalThis.canvas;
}

const wolf = { id: "wolf", center: { x: 400, y: 300 }, w: 100, h: 100, hasDynamicRing: false };

test("the flare is drawn at the token, above the token layer, in added light", async () => {
  const board = freshCanvas();
  await playAnimaFlare(wolf, { color: "#FF6A1A" });
  const [effect] = board.interface.children;
  assert.ok(effect, "nothing was added to the interface group");
  assert.ok(effect.zIndex > 200, "under the token layer, each token's void mesh erases it");
  assert.equal(effect.position.x, 400);
  assert.equal(effect.position.y, 300);
  assert.equal(effect.children[0].blendMode, 1);
  assert.ok(effect.children[0].shapes > 0, "a frame mid-flare drew nothing");
});

test("it animates for its duration, named for its token, and is destroyed after", async () => {
  const board = freshCanvas();
  await playAnimaFlare(wolf, { color: "#FF6A1A" });
  assert.equal(animations.length, 1);
  assert.equal(animations[0].duration, FLARE_DURATION);
  assert.ok(String(animations[0].name).includes("wolf"));
  assert.equal(board.interface.children[0].destroyed, true);
});

test("photosensitive mode plays it more slowly", async () => {
  freshCanvas({ photosensitive: true });
  await playAnimaFlare(wolf, { color: "#FF6A1A" });
  assert.equal(animations[0].duration, FLARE_DURATION_GENTLE);
});

test("a canvas torn down mid-flare is left alone rather than thrown at", async () => {
  const board = freshCanvas({ onAnimate: (options) => { options.context.destroyed = true; } });
  await assert.doesNotReject(playAnimaFlare(wolf, { color: "#FF6A1A" }));
  assert.equal(board.interface.children[0].destroyed, true);
});
