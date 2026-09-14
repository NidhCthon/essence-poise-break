// The gambit list: which gambits a weapon can use against a target, and what
// each costs. The panel opens the roller with the gambit already chosen, and
// the roller only recomputes the cost when the choice changes - so the number
// here is the one that gets spent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel } from "./foundry.mjs";

const { GAMBITS, priceGambit, legality } = panel;

// The system's own table, from myFormHandler in module/apps/dice-roller.js.
// tools/check-roller.py watches the upstream copy for changes; this pins the
// panel's copy to it.
const SYSTEM_COSTS = {
  disarm: "defense", distract: 2, ensnare: 3, knockback: 4, knockdown: 4,
  pilfer: 3, pull: 4, reveal_weakness: 3, unhorse: 5
};

const weapon = (tags = {}) => ({
  system: { traits: { weapontags: { selected: tags } } }
});
const character = {
  type: "character",
  system: { abilities: { physique: { value: 4 }, athletics: { value: 2 } } }
};
const antagonist = { type: "npc", system: { pools: { primary: { value: 5 } } } };

function price(key, { tags = {}, target = character, defense = 5, reforged = true } = {}) {
  const gambit = GAMBITS.find((g) => g.key === key);
  assert.ok(gambit, `no gambit ${key}`);
  return priceGambit(gambit, weapon(tags), target, defense, reforged);
}

test("every gambit's key and cost matches the system's table", () => {
  const ours = Object.fromEntries(
    GAMBITS.filter((g) => g.key !== "grapple").map((g) => [g.key, g.cost]));
  assert.deepEqual(ours, SYSTEM_COSTS);
});

test("Disarm costs the target's Defense", () => {
  assert.equal(price("disarm", { defense: 4 }).power, 4);
});

test("a smashing weapon takes 1 off Knockback and Knockdown, and nothing else", () => {
  const tags = { smashing: true };
  assert.equal(price("knockback", { tags }).power, 3);
  assert.equal(price("knockdown", { tags }).power, 3);
  assert.equal(price("ensnare", { tags }).power, 3);
});

test("a flexible weapon takes 1 off Ensnare", () => {
  assert.equal(price("ensnare", { tags: { flexible: true } }).power, 2);
});

test("Pull needs a weapon with the pull tag", () => {
  assert.match(price("pull").blocked, /pull tag/);
  assert.equal(price("pull", { tags: { pull: true } }).power, 4);
});

test("Grapple is only a gambit under Combat Reforged", () => {
  assert.ok(price("grapple", { reforged: false }).blocked);
});

test("Grapple costs the higher of the target's Physique or Athletics", () => {
  const row = price("grapple");
  assert.equal(row.power, 4);
  assert.match(row.working, /Physique 4/);
});

test("against an antagonist, half its primary pool rounded up, flagged as the Storyteller's call", () => {
  const row = price("grapple", { target: antagonist });
  assert.equal(row.power, 3);
  assert.ok(row.note, "the row should say another pool may apply");
});

test("with no target, gambits priced off the target say so rather than guess", () => {
  assert.match(price("disarm", { target: null }).blocked, /pick a target/);
  assert.match(price("grapple", { target: null }).blocked, /pick a target/);
  assert.equal(price("distract", { target: null }).power, 2);
});

test("Knockback and Grapple are marked as finished by the panel, the rest are not", () => {
  assert.ok(price("knockback").panelApplies);
  assert.ok(price("grapple").panelApplies);
  assert.ok(!price("knockdown").panelApplies);
  assert.ok(!price("distract").panelApplies);
});

test("a standing target blocks gambits under Reforged, and the reason names Hero's Trick", () => {
  const standing = { type: "npc", system: { poise: { value: 3 } }, effects: [] };
  const { allow, why } = legality(standing, true);
  assert.equal(allow.gambit, false);
  assert.match(why.gambit, /Hero's Trick/);
});
