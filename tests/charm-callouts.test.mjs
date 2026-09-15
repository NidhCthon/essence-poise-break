// Charm callouts: what counts as using a Charm, who sees its name, that the
// system's own steps still run untouched, and where the names are drawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings, fireOnce } from "./foundry.mjs";

const {
  calloutNames, calloutPayload, rollerCallout, sheetCallout, shouldShowCallouts,
  wrapRollerResources, wrapSpendItem, calloutFrame, calloutLines, calloutSize,
  calloutLayout, playCalloutsOnToken, playCallouts, receiveCallouts,
  CALLOUT_MESSAGE, CALLOUT_DURATION, CALLOUT_DURATION_GENTLE, CALLOUT_STAGGER, CALLOUT_MAX,
  CALLOUT_SIZE_MIN, CALLOUT_SIZE_MAX, CUT_IN_FALLBACK
} = panel;

const scene = { id: "scene" };
const tokenFor = (id = "tok") => ({ document: { id, parent: scene } });
const player = { id: "player", isGM: false };
const storyteller = { id: "gm", isGM: true };

function actor({ owner = true, color = "#2E8BFF", token = tokenFor() } = {}) {
  return {
    uuid: "Actor.hero", name: "Rising Tide", img: "hero.webp", hasPlayerOwner: owner,
    system: { details: { animacolor: color } },
    token: null,
    getActiveTokens: () => (token ? [token] : [])
  };
}

const charm = (name, { id = name, active = false } = {}) =>
  ({ id, name, type: "charm", system: { active } });

function roller(charms = [charm("Tidebreaker Blade")], { owner = true, token = tokenFor() } = {}) {
  return { actor: actor({ owner }), object: { addedCharms: charms }, _getActorToken: () => token };
}

const quietly = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

/* --------------------------- what is called out --------------------------- */

test("Charm names are trimmed, kept once each, and only Charms count", () => {
  assert.deepEqual(calloutNames([
    charm(" Tidebreaker Blade "), charm("Tidebreaker Blade", { id: "b" }),
    { name: "Artifact", type: "merit" }, charm(""), { name: "Undertow Grip" }
  ]), ["Tidebreaker Blade", "Undertow Grip"]);
  assert.deepEqual(calloutNames(undefined), []);
});

test("a callout needs names and a token to call them from", () => {
  assert.equal(calloutPayload(actor(), tokenFor(), []), null);
  assert.equal(calloutPayload(actor(), null, ["Tidebreaker Blade"]), null);
  const payload = calloutPayload(actor(), tokenFor(), ["Tidebreaker Blade"]);
  assert.equal(payload.tokenId, "tok");
  assert.equal(payload.sceneId, "scene");
  assert.deepEqual(payload.charms, ["Tidebreaker Blade"]);
  assert.equal(payload.storyteller, false);
});

test("a roller calls each Charm out once, though it pays twice in an attack", () => {
  const form = roller([charm("Tidebreaker Blade"), charm("Undertow Grip")]);
  assert.deepEqual(rollerCallout(form).charms, ["Tidebreaker Blade", "Undertow Grip"]);
  assert.equal(rollerCallout(form), null, "the damage roll's payment is quiet");
  form.object.addedCharms.push(charm("Salt-Wind Stance"));
  assert.deepEqual(rollerCallout(form).charms, ["Salt-Wind Stance"], "a Charm added later still is");
});

test("a roll with no Charms, or only merits, calls nothing out", () => {
  assert.equal(rollerCallout(roller([])), null);
  assert.equal(rollerCallout(roller([{ id: "m", name: "Artifact", type: "merit" }])), null);
  assert.equal(rollerCallout({ object: { addedCharms: [charm("X")] } }), null);
});

test("using a Charm from the sheet calls it out; switching one off does not", () => {
  assert.deepEqual(sheetCallout(actor(), charm("Tidebreaker Blade")).charms, ["Tidebreaker Blade"]);
  assert.equal(sheetCallout(actor(), charm("Tidebreaker Blade", { active: true })), null);
  assert.equal(sheetCallout(actor(), { name: "Artifact", type: "merit", system: {} }), null);
  assert.equal(sheetCallout(actor({ token: null }), charm("Tidebreaker Blade")), null);
});

/* ------------------------------- the wraps ------------------------------- */

function spies() {
  const order = [];
  const sent = [];
  const played = [];
  return {
    order, sent, played,
    options: {
      emit: (m) => { order.push("send"); sent.push(m); },
      play: (p) => { order.push("play"); played.push(p); },
      show: () => true
    }
  };
}

test("the roller's payment runs first, and its promise passes through", async () => {
  const { order, sent, options } = spies();
  class RollForm {}
  const paid = Promise.resolve("paid");
  RollForm.prototype._updateRollerResources = function () { order.push("system"); return paid; };
  wrapRollerResources(RollForm, options);
  const form = Object.assign(new RollForm(), roller());
  assert.equal(form._updateRollerResources(), paid);
  form._updateRollerResources();
  assert.deepEqual(order, ["system", "send", "play", "system"]);
  assert.equal(sent[0].type, CALLOUT_MESSAGE);
});

test("a failure in a callout never escapes the roller's payment", async () => {
  class RollForm {}
  RollForm.prototype._updateRollerResources = () => "paid";
  wrapRollerResources(RollForm, {
    emit: () => { throw new Error("socket down"); },
    play: () => { throw new Error("no canvas"); },
    show: () => true
  });
  const result = await quietly(() => Object.assign(new RollForm(), roller())._updateRollerResources());
  assert.equal(result, "paid");
});

test("the actor's spend runs, and a Charm it switches on is still called out", () => {
  const { order, played, options } = spies();
  class Actor {}
  Actor.prototype.spendItem = function (item) { order.push("system"); item.system.active = true; return "spent"; };
  wrapSpendItem(Actor, options);
  const hero = Object.assign(new Actor(), actor());
  assert.equal(hero.spendItem(charm("Tidebreaker Blade")), "spent");
  assert.deepEqual(order, ["system", "send", "play"]);
  assert.deepEqual(played[0].charms, ["Tidebreaker Blade"]);
});

test("an error the system throws still reaches whoever spent the item", () => {
  const { sent, options } = spies();
  class Actor {}
  Actor.prototype.spendItem = () => { throw new Error("not enough motes"); };
  wrapSpendItem(Actor, options);
  assert.throws(() => Object.assign(new Actor(), actor()).spendItem(charm("X")), /not enough motes/);
  assert.equal(sent.length, 0, "nothing is called out for a spend that failed");
});

test("each method is wrapped once, and a system without it is left alone", () => {
  class RollForm {}
  RollForm.prototype._updateRollerResources = () => {};
  assert.equal(wrapRollerResources(RollForm), true);
  assert.equal(wrapRollerResources(RollForm), false);
  class Actor {}
  assert.equal(wrapSpendItem(Actor), false);
  assert.equal(Actor.prototype.spendItem, undefined);
  assert.equal(wrapRollerResources(undefined), false);
});

test("the ready hook wraps the system's roller and actor", async () => {
  class RollForm {}
  RollForm.prototype._updateRollerResources = () => {};
  class ExaltedActor {}
  ExaltedActor.prototype.spendItem = () => {};
  game.exaltedessence = { RollForm };
  CONFIG.Actor = { documentClass: ExaltedActor };
  await fireOnce("ready");
  assert.equal(RollForm.prototype._updateRollerResources.epbCallouts, true);
  assert.equal(ExaltedActor.prototype.spendItem.epbCallouts, true);
});

/* ----------------------------- who sees what ----------------------------- */

function viewing({ sceneId = "scene", tokens = {} } = {}) {
  globalThis.canvas = { ...globalThis.canvas, scene: { id: sceneId }, tokens: { get: (id) => tokens[id] } };
}

test("callouts play for a token this player can see, on the scene they are viewing", () => {
  const payload = calloutPayload(actor(), tokenFor(), ["Tidebreaker Blade"]);
  viewing({ tokens: { tok: { isVisible: true } } });
  assert.equal(shouldShowCallouts(payload), true);
  viewing({ tokens: { tok: { isVisible: false } } });
  assert.equal(shouldShowCallouts(payload), false);
  viewing({ sceneId: "elsewhere", tokens: { tok: { isVisible: true } } });
  assert.equal(shouldShowCallouts(payload), false);
  viewing({ tokens: { tok: { isVisible: true } } });
  settings.set("essence-poise-break.charmCallouts", false);
  try {
    assert.equal(shouldShowCallouts(payload), false);
  } finally {
    settings.set("essence-poise-break.charmCallouts", true);
  }
});

test("a received callout is cleaned, and needs a token and Charms", () => {
  const played = [];
  const options = { play: (p) => played.push(p), show: () => true };
  receiveCallouts({ type: "animaFlare", payload: { name: "X", tokenId: "t", sceneId: "s", charms: ["A"] } }, options);
  receiveCallouts({ type: CALLOUT_MESSAGE, payload: { name: "X", charms: ["A"] } }, options);
  receiveCallouts({ type: CALLOUT_MESSAGE, payload: { name: "X", tokenId: "t", sceneId: "s", charms: [] } }, options);
  receiveCallouts(null, options);
  assert.equal(played.length, 0);
  receiveCallouts({ type: CALLOUT_MESSAGE, payload: {
    name: " X ", tokenId: "t", sceneId: "s", charms: ["A", 5], color: "url(x)"
  } }, options);
  assert.equal(played.length, 1);
  assert.deepEqual(played[0].charms, ["A"]);
  assert.equal(played[0].color, CUT_IN_FALLBACK);
});

/* ------------------------------ the drawing ------------------------------ */

test("each name bursts in large, lands at its size, and fades out by the end", () => {
  assert.equal(calloutFrame(0).alpha, 0);
  assert.ok(calloutFrame(0).scale > 1.5, "it starts large");
  assert.ok(calloutFrame(0.02).scale < calloutFrame(0).scale, "and shrinks as it lands");
  assert.equal(calloutFrame(0.14).scale, 1);
  assert.equal(calloutFrame(1).alpha, 0);
});

test("photosensitive mode: no burst, only a fade", () => {
  for (const t of [0, 0.05, 0.3, 0.8, 1]) {
    assert.equal(calloutFrame(t, { gentle: true }).scale, 1);
  }
  assert.equal(calloutFrame(1, { gentle: true }).alpha, 0);
});

test("a long list calls out the first few names and counts the rest", () => {
  const names = ["One", "Two", "Three", "Four", "Five", "Six"];
  assert.deepEqual(calloutLines(names), ["One", "Two", "Three", "Four", `+${6 - CALLOUT_MAX} more`]);
  assert.deepEqual(calloutLines(["One"]), ["One"]);
});

test("names are sized to the token within readable bounds", () => {
  assert.equal(calloutSize(10), CALLOUT_SIZE_MIN);
  assert.equal(calloutSize(500), CALLOUT_SIZE_MAX);
  assert.ok(calloutSize(70) > CALLOUT_SIZE_MIN && calloutSize(70) < CALLOUT_SIZE_MAX);
});

test("on an ordinary token a name is big enough to read with the map zoomed out", () => {
  // A 100px grid square is a radius of 50. The first size gave 18px, which
  // the table found too small to read.
  assert.ok(calloutSize(50) >= 30);
});

test("later names come out later and sit higher", () => {
  const layout = calloutLayout(CALLOUT_STAGGER / 2, 3, { radius: 50, size: 20, hue: 0x2E8BFF });
  assert.ok(layout[0].alpha > 0, "the first name is already out");
  assert.equal(layout[1].alpha, 0, "the second has not burst yet");
  assert.ok(layout[1].y < layout[0].y && layout[2].y < layout[1].y);
});

/* ---------------------------- a fake canvas ---------------------------- */

class FakeContainer {
  constructor() {
    this.children = [];
    this.destroyed = false;
    this.zIndex = 0;
    this.alpha = 1;
    this.position = { x: 0, y: 0, set: (x, y = x) => { this.position.x = x; this.position.y = y; } };
    this.scale = { x: 1, set: (v) => { this.scale.x = v; } };
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

const animations = [];

function freshCanvas({ photosensitive = false, onAnimate = null, tokens = {} } = {}) {
  animations.length = 0;
  globalThis.PIXI = {
    Container: FakeContainer,
    Text: FakeText,
    TextStyle: class { constructor(options) { Object.assign(this, options); } }
  };
  foundry.canvas = {
    animation: {
      CanvasAnimation: {
        animate(attributes, options) {
          animations.push(options);
          onAnimate?.(options);
          for (const a of attributes) a.parent[a.attribute] = 0.5;
          options.ontick?.();
          return Promise.resolve(true);
        }
      }
    }
  };
  globalThis.canvas = {
    interface: new FakeContainer(), photosensitiveMode: photosensitive,
    scene: { id: "scene" }, tokens: { get: (id) => tokens[id] }
  };
  CONFIG.Canvas = { groups: { interface: { zIndexScrollingText: 1100 } } };
  return globalThis.canvas;
}

const wolf = { id: "tok", center: { x: 400, y: 300 }, w: 100, h: 100, isVisible: true };

test("the names are drawn over the token, above the token layer, one text each", async () => {
  const board = freshCanvas();
  await playCalloutsOnToken(wolf, ["Tidebreaker Blade", "Undertow Grip"], "#2E8BFF");
  const [effect] = board.interface.children;
  assert.ok(effect.zIndex > 200);
  assert.equal(effect.position.x, 400);
  assert.deepEqual(effect.children.map((c) => c.text), ["Tidebreaker Blade", "Undertow Grip"]);
  assert.equal(effect.destroyed, true);
});

test("it runs as long as the last name needs, named for its token", async () => {
  freshCanvas();
  await playCalloutsOnToken(wolf, ["A", "B", "C"], "#2E8BFF");
  assert.equal(animations[0].duration, CALLOUT_DURATION + 2 * CALLOUT_STAGGER);
  assert.ok(String(animations[0].name).includes("tok"));
  freshCanvas({ photosensitive: true });
  await playCalloutsOnToken(wolf, ["A"], "#2E8BFF");
  assert.equal(animations[0].duration, CALLOUT_DURATION_GENTLE);
});

test("a canvas torn down mid-callout is left alone rather than thrown at", async () => {
  const board = freshCanvas({ onAnimate: (options) => { options.context.destroyed = true; } });
  await assert.doesNotReject(playCalloutsOnToken(wolf, ["A"], "#2E8BFF"));
  assert.equal(board.interface.children[0].destroyed, true);
});

test("an antagonist's Charms are drawn for the Storyteller, not for players", async () => {
  const payload = calloutPayload(actor({ owner: false }), tokenFor(), ["Hungry Tide Maw"]);
  let board = freshCanvas({ tokens: { tok: wolf } });
  assert.equal(playCallouts(payload, { user: player }), null);
  assert.equal(board.interface.children.length, 0);

  board = freshCanvas({ tokens: { tok: wolf } });
  await playCallouts(payload, { user: storyteller });
  assert.equal(board.interface.children.length, 1);

  settings.set("essence-poise-break.revealStorytellerCharms", true);
  try {
    board = freshCanvas({ tokens: { tok: wolf } });
    await playCallouts(payload, { user: player });
    assert.equal(board.interface.children.length, 1);
  } finally {
    settings.set("essence-poise-break.revealStorytellerCharms", false);
  }
});
