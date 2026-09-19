// Gambit callouts: the name a landed gambit calls out, the wrap around the
// roller's _resolveGambit(), and what arrives from another client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings } from "./foundry.mjs";

const {
  gambitName, gambitCalloutLine, gambitCallout, shouldShowGambitCallout,
  wrapResolveGambit, receiveGambitCallout, GAMBIT_MESSAGE, CUT_IN_SOCKET
} = panel;

const scene = { id: "scene" };

function roller({ gambit = "disarm", owner = false, token = { id: "tok", parent: scene } } = {}) {
  return {
    actor: {
      uuid: "Actor.brute", name: "Wyld Brute", img: "brute.webp", hasPlayerOwner: owner,
      system: { details: { animacolor: "#FFFFFF" } }
    },
    object: { gambit },
    _getActorToken: () => token
  };
}

/* ------------------------------- the name ------------------------------- */

test("a gambit is named as the panel names it", () => {
  assert.equal(gambitName("disarm"), "Disarm");
  assert.equal(gambitName("reveal_weakness"), "Reveal Weakness");
  assert.equal(gambitName("grapple"), "Grapple");
});

test("a gambit the panel does not know takes the system's name, or its key made readable", () => {
  CONFIG.EXALTEDESSENCE = { gambits: { trip_up: "ExEss.TripUp" } };
  game.i18n = { localize: (key) => (key === "ExEss.TripUp" ? "Trip Up" : key) };
  assert.equal(gambitName("trip_up"), "Trip Up");
  game.i18n = { localize: (key) => key };
  assert.equal(gambitName("trip_up"), "Trip Up", "an untranslated label falls back to the key");
  assert.equal(gambitName("shove_hard"), "Shove Hard");
  delete CONFIG.EXALTEDESSENCE;
  delete game.i18n;
});

test("no gambit, or none chosen, names nothing", () => {
  for (const key of ["", "none", undefined, null, 7, "   "]) assert.equal(gambitName(key), "", String(key));
});

test("it is called out in capitals, with feeling", () => {
  assert.equal(gambitCalloutLine("Reveal Weakness"), "REVEAL WEAKNESS!");
});

/* ------------------------------ the payload ----------------------------- */

test("a landed gambit calls out from the attacker's token", () => {
  const payload = gambitCallout(roller());
  assert.deepEqual(payload.charms, ["Disarm"]);
  assert.equal(payload.tokenId, "tok");
  assert.equal(payload.sceneId, "scene");
  assert.equal(payload.name, "Wyld Brute");
});

test("with no gambit, no actor or no token there is nothing to call out", () => {
  assert.equal(gambitCallout(roller({ gambit: "" })), null);
  assert.equal(gambitCallout(roller({ token: null })), null);
  assert.equal(gambitCallout({ object: { gambit: "disarm" } }), null);
  assert.equal(gambitCallout(null), null);
});

/* ------------------------------- the wrap ------------------------------- */

function rollForm(order) {
  return class {
    constructor(r) { Object.assign(this, r); }
    _resolveGambit(total) { order.push(`system:${total}`); return "resolved"; }
  };
}

test("the system resolves the gambit first and unchanged; then it is sent and played", () => {
  const order = [];
  const RollForm = rollForm(order);
  const sent = [];
  wrapResolveGambit(RollForm, {
    emit: (message) => { order.push("send"); sent.push(message); },
    play: (payload) => order.push(`play:${payload.charms[0]}`),
    show: () => true
  });
  const result = new RollForm(roller({ gambit: "knockback" }))._resolveGambit(3);
  assert.equal(result, "resolved");
  assert.deepEqual(order, ["system:3", "send", "play:Knockback"]);
  assert.equal(sent[0].type, GAMBIT_MESSAGE);
});

test("an antagonist's gambit is named for everyone, unlike its Charms", () => {
  const sent = [];
  const RollForm = rollForm([]);
  wrapResolveGambit(RollForm, { emit: (m) => sent.push(m), play: () => {}, show: () => false });
  new RollForm(roller({ owner: false }))._resolveGambit(1);
  assert.deepEqual(sent[0].payload.charms, ["Disarm"]);
  assert.equal(settings.get("essence-poise-break.revealStorytellerCharms"), false);
});

test("nothing that goes wrong in the callout reaches the roll", () => {
  const RollForm = rollForm([]);
  wrapResolveGambit(RollForm, {
    emit: () => { throw new Error("no socket"); },
    play: () => { throw new Error("no canvas"); },
    show: () => true
  });
  assert.equal(new RollForm(roller())._resolveGambit(0), "resolved");
  const Unreadable = rollForm([]);
  wrapResolveGambit(Unreadable, { emit: () => {}, play: () => {}, show: () => true });
  const form = new Unreadable(roller());
  form._getActorToken = () => { throw new Error("gone"); };
  assert.equal(form._resolveGambit(0), "resolved");
});

test("it wraps once, and leaves a roller without the step alone", () => {
  const RollForm = rollForm([]);
  assert.equal(wrapResolveGambit(RollForm, { emit: () => {}, play: () => {} }), true);
  assert.equal(wrapResolveGambit(RollForm, { emit: () => {}, play: () => {} }), false);
  assert.equal(wrapResolveGambit(class {}), false);
  assert.equal(wrapResolveGambit(undefined), false);
});

/* ------------------------------ receiving ------------------------------- */

test("one received from another client is cleaned, then played if it should be", () => {
  const played = [];
  const options = { play: (p) => played.push(p), show: () => true };
  receiveGambitCallout({ type: GAMBIT_MESSAGE, payload: { name: "X", tokenId: "t", sceneId: "s", charms: ["Pull", 5, ""] } }, options);
  assert.deepEqual(played[0].charms, ["Pull"]);
  receiveGambitCallout({ type: "charmCallout", payload: { name: "X", charms: ["Pull"] } }, options);
  receiveGambitCallout({ type: GAMBIT_MESSAGE, payload: { name: "X", charms: [] } }, options);
  receiveGambitCallout({ type: GAMBIT_MESSAGE }, options);
  receiveGambitCallout(null, options);
  assert.equal(played.length, 1);
});

test("it shows only for a token this player can see, and not with the setting off", () => {
  const payload = { tokenId: "tok", sceneId: "scene", charms: ["Disarm"] };
  globalThis.canvas = { scene, tokens: { get: (id) => (id === "tok" ? { isVisible: true, destroyed: false } : null) } };
  assert.equal(shouldShowGambitCallout(payload), true);
  assert.equal(shouldShowGambitCallout({ ...payload, tokenId: "other" }), false);
  settings.set("essence-poise-break.gambitCallouts", false);
  assert.equal(shouldShowGambitCallout(payload), false);
  settings.set("essence-poise-break.gambitCallouts", true);
  globalThis.canvas = { scene, tokens: { get: () => ({ isVisible: false, destroyed: false }) } };
  assert.equal(shouldShowGambitCallout(payload), false);
  delete globalThis.canvas;
  assert.equal(typeof CUT_IN_SOCKET, "string");
});
