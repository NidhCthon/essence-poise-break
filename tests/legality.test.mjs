// legality(): which attacks the panel offers against a target, and why the
// rest are greyed out. This is the module's headline rule - the panel exists to
// offer only attacks that can land - and until now only one of its five
// outcomes had a direct test.
//
// The branch order is part of the rule, so it is pinned too: a battle group is
// recognised before the ruleset is consulted, and Break before Poise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel } from "./foundry.mjs";

const { legality } = panel;

const npc = ({ poise = 3, broken = false, battlegroup = false } = {}) => ({
  type: "npc",
  system: { poise: { value: poise }, battlegroup },
  effects: broken ? [{ statuses: new Set(["break"]) }] : []
});

const everything = { withering: true, decisive: true, gambit: true };

test("with no target, nothing is ruled out", () => {
  const { allow, why, state } = legality(null, true);
  assert.equal(state, "none");
  assert.deepEqual(allow, everything);
  assert.deepEqual(why, {});
});

test("under standard rules, every attack is open against an ordinary target", () => {
  const { allow, state } = legality(npc({ poise: 3 }), false);
  assert.equal(state, "standard");
  assert.deepEqual(allow, everything);
});

test("a standing target under Reforged blocks decisive attacks and gambits, but not withering", () => {
  const { allow, why, state } = legality(npc({ poise: 3 }), true);
  assert.equal(state, "standing");
  assert.equal(allow.withering, true);
  assert.equal(allow.decisive, false);
  assert.equal(allow.gambit, false);
  assert.match(why.decisive, /3 Poise/, "the reason should say how much Poise is in the way");
  assert.equal(why.withering, undefined, "withering is open, so it needs no reason");
});

test("a target in Break takes decisive attacks and gambits, and cannot be withered", () => {
  const { allow, why, state } = legality(npc({ poise: 0, broken: true }), true);
  assert.equal(state, "break");
  assert.deepEqual(allow, { withering: false, decisive: true, gambit: true });
  assert.match(why.withering, /Break/);
});

test("Break is decided by the status, so Poise left on the sheet does not re-block decisive attacks", () => {
  assert.equal(legality(npc({ poise: 2, broken: true }), true).state, "break");
});

test("battle groups can't be withered, under either ruleset", () => {
  for (const reforged of [true, false]) {
    const { allow, why, state } = legality(npc({ battlegroup: true }), reforged);
    assert.equal(state, "group", `reforged=${reforged}`);
    assert.deepEqual(allow, { withering: false, decisive: true, gambit: true });
    assert.match(why.withering, /Battle groups/);
  }
});

test("a battle group is recognised before Break or Poise are considered", () => {
  assert.equal(legality(npc({ battlegroup: true, broken: true, poise: 3 }), true).state, "group");
});

test("only an antagonist can be a battle group", () => {
  const character = { type: "character", system: { poise: { value: 3 }, battlegroup: true }, effects: [] };
  assert.equal(legality(character, true).state, "standing");
});
