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
