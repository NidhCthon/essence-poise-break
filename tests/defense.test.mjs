// targetNumbers(): the Defense and Poise the roller will actually use against
// a target, which the panel has to predict before the roll exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel } from "./foundry.mjs";

const { targetNumbers } = panel;

const character = (parry, evasion, { effects = [], penalty = 0 } = {}) => ({
  type: "character",
  system: {
    defense: { value: 0 },
    parry: { value: parry },
    evasion: { value: evasion },
    soak: { value: 4 },
    poise: { value: 3 },
    health: { penalty }
  },
  effects
});

const antagonist = (defense) => ({
  type: "npc",
  system: {
    defense: { value: defense },
    soak: { value: 3 },
    poise: { value: 2 },
    health: { penalty: 0 }
  },
  effects: []
});

test("a character defends with the better of Parry and Evasion", () => {
  // Every actor has a defense field defaulting to 0. Reading it first made
  // every character target show Defense 0, until a screenshot caught it.
  assert.equal(targetNumbers(character(3, 5), true).baseDefense, 5);
  assert.equal(targetNumbers(character(4, 2), true).baseDefense, 4);
  assert.equal(targetNumbers(character(0, 0), true).baseDefense, 0);
});

test("an antagonist defends with its single Defense", () => {
  assert.equal(targetNumbers(antagonist(5), true).baseDefense, 5);
  assert.equal(targetNumbers(antagonist(0), true).baseDefense, 0);
});

test("prone and wounds come off the Defense the roller will use", () => {
  const n = targetNumbers(character(3, 5, { effects: [{ name: "prone" }], penalty: 1 }), true);
  assert.equal(n.defense, 2);
  assert.equal(n.working.length, 2, "the working line should name both");
});

test("surprised costs Poise as well as Defense", () => {
  const n = targetNumbers(character(3, 5, { effects: [{ name: "surprised" }] }), true);
  assert.equal(n.defense, 4);
  assert.equal(n.poise, 2);
});

test("grappling only costs Defense under Combat Reforged", () => {
  const grappled = character(3, 5, { effects: [{ name: "grappling" }] });
  assert.equal(targetNumbers(grappled, true).defense, 4);
  assert.equal(targetNumbers(grappled, false).defense, 5);
});

test("incapacitated counts as a wound penalty of 2", () => {
  assert.equal(targetNumbers(character(3, 5, { penalty: "inc" }), true).defense, 3);
});

test("Defense and Poise never go below zero", () => {
  const n = targetNumbers(character(1, 1, {
    effects: [{ name: "prone" }, { name: "surprised" }], penalty: 2
  }), true);
  assert.equal(n.defense, 0);
});

test("conditions are matched by name, exactly as the roller matches them", () => {
  // Foundry names a status effect "Prone"; the roller compares against
  // "prone", so a status set from the token HUD changes nothing in the roll.
  // The panel has to agree with the roller - bug included - or its advice and
  // the dice disagree. If the system fixes the comparison, change both.
  const fromHud = character(3, 5, {
    effects: [{ name: "Prone", statuses: new Set(["prone"]) }]
  });
  assert.equal(targetNumbers(fromHud, true).defense, 5);
});

test("cover and concealment are reported, not folded into Defense", () => {
  const n = targetNumbers(character(3, 5, {
    effects: [{ name: "heavycover" }, { name: "concealment" }]
  }), true);
  assert.equal(n.defense, 5);
  assert.equal(n.notes.length, 2);
});
