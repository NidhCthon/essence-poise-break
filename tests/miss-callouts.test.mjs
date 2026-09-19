// Miss callouts: what counts as a miss, the word the target calls out, the
// wrap around attackSequence() alongside the cut-in's, and received messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings } from "./foundry.mjs";

const {
  isMiss, missWord, missCallout, shouldShowMissCallout, wrapMissCallout, receiveMissCallout,
  wrapAttackSequence, MISS_MESSAGE, MISS_WORDS
} = panel;

const scene = { id: "scene" };

function character({ parry = 3, evasion = 2 } = {}) {
  return { uuid: "Actor.hero", name: "Rising Tide", type: "character", hasPlayerOwner: true,
    system: { parry: { value: parry }, evasion: { value: evasion }, details: {} } };
}
const antagonist = { uuid: "Actor.brute", name: "Wyld Brute", type: "npc", hasPlayerOwner: false,
  system: { defense: { value: 3 }, details: {} } };

function roller({ rollType = "withering", accuracy = 2, defense = 4, target = character() } = {}) {
  return {
    object: {
      rollType, accuracyResult: accuracy, defense,
      target: target ? { id: "target-token", document: { id: "target-token", parent: scene }, actor: target } : null
    }
  };
}

/* ------------------------------- a miss ------------------------------- */

test("an attack short of Defense is a miss; meeting it is not", () => {
  assert.equal(isMiss({ rollType: "withering", accuracyResult: 2, defense: 4 }), true);
  assert.equal(isMiss({ rollType: "decisive", accuracyResult: 3, defense: 4 }), true);
  assert.equal(isMiss({ rollType: "gambit", accuracyResult: 0, defense: 1 }), true);
  assert.equal(isMiss({ rollType: "withering", accuracyResult: 4, defense: 4 }), false, "meeting Defense hits");
  assert.equal(isMiss({ rollType: "withering", accuracyResult: 6, defense: 4 }), false);
});

test("a roll that is not an attack, or has no numbers, is not a miss", () => {
  assert.equal(isMiss({ rollType: "base", accuracyResult: 0, defense: 4 }), false);
  assert.equal(isMiss({ rollType: "withering", accuracyResult: "x", defense: 4 }), false);
  assert.equal(isMiss(null), false);
});

/* ------------------------------- the word ------------------------------ */

test("a character parries or dodges by whichever Defense stopped it", () => {
  assert.equal(missWord(character({ parry: 4, evasion: 2 })), "PARRIED!");
  assert.equal(missWord(character({ parry: 2, evasion: 4 })), "DODGED!");
  assert.equal(missWord(character({ parry: 3, evasion: 3 })), "PARRIED!", "the roller takes Parry on a tie");
});

test("an antagonist, with one Defense, makes it miss", () => {
  assert.equal(missWord(antagonist), "MISS!");
  assert.equal(missWord(null), "MISS!");
});

test("the callout comes from the target's token, not the attacker's", () => {
  const payload = missCallout(roller());
  assert.equal(payload.tokenId, "target-token");
  assert.equal(payload.sceneId, "scene");
  assert.equal(payload.name, "Rising Tide");
  assert.deepEqual(payload.charms, ["PARRIED!"]);
});

test("a hit, or an attack with no target, calls nothing out", () => {
  assert.equal(missCallout(roller({ accuracy: 5 })), null);
  assert.equal(missCallout(roller({ target: null })), null);
  assert.equal(missCallout({}), null);
});

/* ------------------------------- the wrap ------------------------------ */

function rollForm(order) {
  return class {
    constructor(r) { Object.assign(this, r); }
    attackSequence() { order.push("system"); return "animated"; }
  };
}

test("the system's step runs first and unchanged; then it is sent and played", () => {
  const order = [];
  const RollForm = rollForm(order);
  const sent = [];
  wrapMissCallout(RollForm, {
    emit: (m) => { order.push("send"); sent.push(m); },
    play: (p) => order.push(`play:${p.charms[0]}`),
    show: () => true
  });
  assert.equal(new RollForm(roller({ target: antagonist })).attackSequence(), "animated");
  assert.deepEqual(order, ["system", "send", "play:MISS!"]);
  assert.equal(sent[0].type, MISS_MESSAGE);
});

test("wrapped alongside the cut-in, each still plays, and neither wraps twice", () => {
  const order = [];
  const RollForm = rollForm(order);
  assert.equal(wrapAttackSequence(RollForm, { emit: () => {}, play: () => order.push("cut-in"), show: () => true }), true);
  assert.equal(wrapMissCallout(RollForm, { emit: () => {}, play: () => order.push("miss"), show: () => true }), true);
  assert.equal(wrapAttackSequence(RollForm), false, "the cut-in lost track of its own wrap");
  assert.equal(wrapMissCallout(RollForm), false);
  new RollForm(roller({ target: antagonist })).attackSequence();
  assert.deepEqual(order, ["system", "miss"], "a miss is not a decisive hit");
});

test("nothing that goes wrong in the callout reaches the roll", () => {
  const RollForm = rollForm([]);
  wrapMissCallout(RollForm, {
    emit: () => { throw new Error("no socket"); },
    play: () => { throw new Error("no canvas"); },
    show: () => true
  });
  assert.equal(new RollForm(roller()).attackSequence(), "animated");
  assert.equal(wrapMissCallout(undefined), false);
});

/* ------------------------------ receiving ------------------------------ */

test("only the three words are played from another client", () => {
  const played = [];
  const options = { play: (p) => played.push(p.charms[0]), show: () => true };
  const base = { name: "X", tokenId: "t", sceneId: "s" };
  for (const word of MISS_WORDS) receiveMissCallout({ type: MISS_MESSAGE, payload: { ...base, charms: [word] } }, options);
  receiveMissCallout({ type: MISS_MESSAGE, payload: { ...base, charms: ["ANYTHING ELSE"] } }, options);
  receiveMissCallout({ type: "gambitCallout", payload: { ...base, charms: ["MISS!"] } }, options);
  receiveMissCallout(null, options);
  assert.deepEqual(played, MISS_WORDS);
});

test("it shows only for a token this player can see, and not with the setting off", () => {
  const payload = { tokenId: "tok", sceneId: "scene", charms: ["MISS!"] };
  globalThis.canvas = { scene, tokens: { get: () => ({ isVisible: true, destroyed: false }) } };
  assert.equal(shouldShowMissCallout(payload), true);
  settings.set("essence-poise-break.missCallouts", false);
  assert.equal(shouldShowMissCallout(payload), false);
  settings.set("essence-poise-break.missCallouts", true);
  globalThis.canvas = { scene, tokens: { get: () => ({ isVisible: false, destroyed: false }) } };
  assert.equal(shouldShowMissCallout(payload), false);
  delete globalThis.canvas;
});
