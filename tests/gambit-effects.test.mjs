// The timed effects gambits leave behind: recording when each began, and
// clearing each once its round is over.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { panel, settings, fireOnce, wait } from "./foundry.mjs";

const {
  gambitEffectOver, sweepGambitEffects, stampGambitEffect, roundAdvanced,
  timedGambitEffect
} = panel;

/* ------------------------------ fixtures ------------------------------ */

/** Distract, Pull and Knockback's rest-of-the-round Defense penalty. */
const penalty = (id, { began = 3, expired = false } = {}) => ({
  id, name: "Defense Penalty (-2)",
  flags: { exaltedessence: { statusId: "end_of_round" } },
  duration: { value: 1, units: "rounds", expired },
  start: began === null ? null : { round: began }
});

const weakness = (id, rounds, began = 3) => ({
  id, name: "Reveal Weakness",
  flags: { exaltedessence: { statusId: "reveal_weakness" } },
  duration: { value: rounds, units: "rounds" },
  start: { round: began }
});

// Effects that must survive every sweep.
const grappling = (id) => ({
  id, name: "Grappling", statuses: new Set(["grappling"]),
  flags: { "essence-poise-break": { grapple: true }, exaltedessence: { statusId: "grappling" } },
  duration: { value: null }, start: null
});
const onslaught = (id) => ({
  id, name: "Wearing Down (2)",
  flags: { exaltedessence: { statusId: "onslaught" } },
  duration: { value: 10, units: "rounds" }, start: { round: 1 }
});
const sheetPenalty = (id) => ({
  id, name: "Defense Penalty", flags: {},
  duration: { value: 10, units: "rounds" }, start: { round: 1 }
});

function makeActor(name, effects) {
  const actor = {
    name, uuid: `Actor.${name}`, effects, deleteCalls: 0, deleted: [],
    async deleteEmbeddedDocuments(type, ids) {
      actor.deleteCalls++;
      actor.deleted.push(...ids);
      actor.effects = actor.effects.filter((e) => !ids.includes(e.id));
    }
  };
  return actor;
}

const makeCombat = (round, actors) => ({
  round, previous: { round: round - 1 },
  combatants: actors.map((actor) => ({ actor }))
});

/* ----------------------------- durations ------------------------------ */

test("a rest-of-the-round penalty lasts the round it was applied in, and no longer", () => {
  assert.equal(gambitEffectOver(penalty("p", { began: 3 }), 3), false);
  assert.equal(gambitEffectOver(penalty("p", { began: 3 }), 4), true);
});

test("Reveal Weakness lasts its own number of rounds", () => {
  assert.equal(gambitEffectOver(weakness("w", 3, 3), 5), false);
  assert.equal(gambitEffectOver(weakness("w", 3, 3), 6), true);
});

test("Reveal Weakness with no extra successes still lasts the rest of the round", () => {
  assert.equal(gambitEffectOver(weakness("w", 0, 3), 3), false);
  assert.equal(gambitEffectOver(weakness("w", 0, 3), 4), true);
});

test("an effect with no start round is read as rest-of-the-round", () => {
  // Every one the roller created before this existed, and any created while
  // no Storyteller was connected to stamp it.
  assert.equal(gambitEffectOver(penalty("p", { began: null }), 1), true);
});

test("one Foundry has already marked expired is over", () => {
  assert.equal(gambitEffectOver(penalty("p", { began: 3, expired: true }), 3), true);
});

test("effects that are not a gambit's are never timed out", () => {
  for (const effect of [grappling("g"), onslaught("o"), sheetPenalty("s")]) {
    assert.equal(timedGambitEffect(effect), null, effect.name);
    assert.equal(gambitEffectOver(effect, 99), false, effect.name);
  }
});

/* ------------------------------ the sweep ----------------------------- */

test("a round change clears what is over and keeps everything else", async () => {
  const a = makeActor("a", [
    penalty("p1", { began: 3 }), weakness("w1", 3, 3),
    grappling("g1"), onslaught("o1"), sheetPenalty("s1")
  ]);
  const b = makeActor("b", [penalty("p2", { began: 4 })]);
  await sweepGambitEffects(makeCombat(4, [a, b]));
  assert.deepEqual(a.deleted, ["p1"]);
  assert.deepEqual(b.deleted, []);
});

test("an actor on two combatants is swept once", async () => {
  const a = makeActor("a", [penalty("p1", { began: 1 })]);
  await sweepGambitEffects(makeCombat(4, [a, a]));
  assert.equal(a.deleteCalls, 1);
});

test("ending the combat clears every timed gambit effect, however long it had left", async () => {
  const a = makeActor("a", [
    penalty("p1", { began: 4 }), weakness("w1", 5, 4), grappling("g1"), onslaught("o1")
  ]);
  await sweepGambitEffects(makeCombat(4, [a]), { ended: true });
  assert.deepEqual(a.deleted.sort(), ["p1", "w1"]);
});

test("only the Storyteller's client clears anything", async () => {
  const a = makeActor("a", [penalty("p1", { began: 1 })]);
  const responsible = game.users.activeGM;
  game.users.activeGM = { isSelf: false };
  try {
    await sweepGambitEffects(makeCombat(4, [a]));
  } finally {
    game.users.activeGM = responsible;
  }
  assert.deepEqual(a.deleted, []);
});

test("switched off, it touches nothing", async () => {
  const a = makeActor("a", [penalty("p1", { began: 1 })]);
  settings.set("essence-poise-break.clearGambitEffects", false);
  try {
    await sweepGambitEffects(makeCombat(4, [a]));
  } finally {
    settings.set("essence-poise-break.clearGambitEffects", true);
  }
  assert.deepEqual(a.deleted, []);
});

test("a delete that fails is logged, and does not stop the rest", async () => {
  const error = mock.method(console, "error", () => {});
  const broken = makeActor("broken", [penalty("p1", { began: 1 })]);
  broken.deleteEmbeddedDocuments = async () => { throw new Error("gone"); };
  const fine = makeActor("fine", [penalty("p2", { began: 1 })]);
  await sweepGambitEffects(makeCombat(4, [broken, fine]));
  assert.equal(error.mock.callCount(), 1);
  assert.deepEqual(fine.deleted, ["p2"]);
  error.mock.restore();
});

/* ---------------------------- the stamping ---------------------------- */

function unstamped(overrides = {}) {
  const effect = penalty("p", { began: null });
  effect.updates = [];
  effect.update = async (data) => { effect.updates.push(data); };
  return Object.assign(effect, overrides);
}

test("an effect the roller created with no start round is given one", async () => {
  game.combat = { started: true, id: "c1", round: 3, turn: 2, combatant: { id: "x", initiative: 7 } };
  try {
    const effect = unstamped();
    await stampGambitEffect(effect);
    assert.equal(effect.updates.length, 1);
    assert.equal(effect.updates[0].start.round, 3);
    assert.equal(effect.updates[0].start.combat, "c1");
  } finally {
    game.combat = null;
  }
});

test("Foundry's own getEffectStart is used when it exists", async () => {
  CONFIG.ActiveEffect = { documentClass: { getEffectStart: () => ({ time: 0, round: 9 }) } };
  try {
    const effect = unstamped();
    await stampGambitEffect(effect);
    assert.equal(effect.updates[0].start.round, 9);
  } finally {
    delete CONFIG.ActiveEffect;
  }
});

test("an effect that already knows when it began is left alone", async () => {
  const effect = unstamped({ start: { round: 2 } });
  await stampGambitEffect(effect);
  assert.equal(effect.updates.length, 0);
});

test("effects that are not a gambit's are never stamped", async () => {
  const effect = grappling("g");
  effect.update = async () => assert.fail("a grapple effect was stamped");
  await stampGambitEffect(effect);
});

/* ------------------------------ the wiring ---------------------------- */

test("only a forward round change counts", () => {
  assert.equal(roundAdvanced({ previous: { round: 2 } }, { round: 3 }), true);
  assert.equal(roundAdvanced({ previous: { round: 3 } }, { round: 2 }), false);
  assert.equal(roundAdvanced({ previous: { round: 3 } }, { turn: 1 }), false);
  // The system's resetAll() writes the combat with diff: false, so the round
  // can arrive in `changed` without having moved. Treating that as an advance
  // would clear unstamped effects partway through a round.
  assert.equal(roundAdvanced({ previous: { round: 3 } }, { round: 3 }), false,
    "an update that repeats the round is not an advance");
});

test("once the module is ready, a new round and a finished combat both sweep", async () => {
  await fireOnce("ready");

  const next = makeActor("next", [penalty("p1", { began: 3 })]);
  Hooks.callAll("updateCombat", makeCombat(4, [next]), { round: 4 });
  await wait(20);
  assert.deepEqual(next.deleted, ["p1"]);

  const turnOnly = makeActor("turn", [penalty("p2", { began: 3 })]);
  Hooks.callAll("updateCombat", makeCombat(4, [turnOnly]), { turn: 2 });
  await wait(20);
  assert.deepEqual(turnOnly.deleted, [], "a turn change is not a round change");

  const over = makeActor("over", [weakness("w1", 5, 4)]);
  Hooks.callAll("deleteCombat", makeCombat(4, [over]));
  await wait(20);
  assert.deepEqual(over.deleted, ["w1"]);
});
