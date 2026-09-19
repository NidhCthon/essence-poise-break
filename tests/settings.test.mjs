// The init hook, run for real. A malformed registration is a runtime error in
// Foundry rather than a warning, and it takes the module's whole settings page
// down with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fireOnce, registered } from "./foundry.mjs";

await fireOnce("init");

const byKey = Object.fromEntries(registered.map((r) => [r.key, r.options]));

test("every setting the panel registers is well formed", () => {
  assert.ok(registered.length > 0, "the init hook registered nothing");
  for (const { module, key, options } of registered) {
    assert.equal(module, "essence-poise-break", key);
    assert.ok(options.name, `${key} has no name`);
    assert.ok(options.hint, `${key} has no hint`);
    assert.equal(options.config, true, `${key} is not shown in settings`);
    assert.ok(["world", "client"].includes(options.scope), `${key}: scope ${options.scope}`);
    assert.equal(options.type, Boolean, `${key} is not a Boolean`);
    assert.equal(typeof options.default, "boolean", `${key} has no boolean default`);
  }
});

test("rules the whole table plays by are world settings, not per player", () => {
  assert.equal(byKey.controlSpells.scope, "world");
  assert.equal(byKey.clearGambitEffects.scope, "world");
});

test("control spells are off until a table opts in", () => {
  assert.equal(byKey.controlSpells.default, false);
});

test("clearing finished gambit effects is on by default", () => {
  assert.equal(byKey.clearGambitEffects.default, true);
});

test("the Break effect is each player's own choice, on unless they turn it off", () => {
  assert.equal(byKey.breakEffect.scope, "client");
  assert.equal(byKey.breakEffect.default, true);
});

test("the decisive cut-in is each player's own choice, on unless they turn it off", () => {
  assert.equal(byKey.decisiveCutIn.scope, "client");
  assert.equal(byKey.decisiveCutIn.default, true);
});

test("naming the Storyteller's Charms in the cut-in is the table's call, off by default", () => {
  assert.equal(byKey.revealStorytellerCharms.scope, "world");
  assert.equal(byKey.revealStorytellerCharms.default, false);
});

test("the anima flare is each player's own choice, on unless they turn it off", () => {
  assert.equal(byKey.animaFlare.scope, "client");
  assert.equal(byKey.animaFlare.default, true);
});

test("Charm callouts are each player's own choice, on unless they turn them off", () => {
  assert.equal(byKey.charmCallouts.scope, "client");
  assert.equal(byKey.charmCallouts.default, true);
});

test("the Bonfire aura is each player's own choice, on unless they turn it off", () => {
  assert.equal(byKey.bonfireAura.scope, "client");
  assert.equal(byKey.bonfireAura.default, true);
});

test("hit-stop and screen shake are each player's own choice, on unless they turn them off", () => {
  assert.equal(byKey.hitImpact.scope, "client");
  assert.equal(byKey.hitImpact.default, true);
});

test("the DEFEATED finisher is each player's own choice, on unless they turn it off", () => {
  assert.equal(byKey.defeatedFinisher.scope, "client");
  assert.equal(byKey.defeatedFinisher.default, true);
});

test("Poise damage numbers are each player's own choice, on unless they turn them off", () => {
  assert.equal(byKey.poiseNumbers.scope, "client");
  assert.equal(byKey.poiseNumbers.default, true);
});

test("gambit callouts are each player's own choice, on unless they turn them off", () => {
  assert.equal(byKey.gambitCallouts.scope, "client");
  assert.equal(byKey.gambitCallouts.default, true);
});

test("the round splash is each player's own choice, on unless they turn it off", () => {
  assert.equal(byKey.roundSplash.scope, "client");
  assert.equal(byKey.roundSplash.default, true);
});

test("the VICTORY / DEFEAT finale is each player's own choice, on unless they turn it off", () => {
  assert.equal(byKey.finaleSplash.scope, "client");
  assert.equal(byKey.finaleSplash.default, true);
});

test("the cinematic effects switch is each player's own, on unless they turn it off", () => {
  assert.equal(byKey.cinematicEffects.scope, "client");
  assert.equal(byKey.cinematicEffects.default, true);
});

test("the switch comes before the effects it governs", () => {
  const keys = registered.map((r) => r.key);
  const at = keys.indexOf("cinematicEffects");
  for (const key of ["breakEffect", "decisiveCutIn", "hitImpact", "defeatedFinisher", "poiseNumbers",
    "charmCallouts", "gambitCallouts", "animaFlare", "bonfireAura", "roundSplash", "finaleSplash"]) {
    assert.ok(keys.indexOf(key) > at, `${key} is listed above the switch`);
  }
});
