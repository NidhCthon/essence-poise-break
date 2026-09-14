// resolveMissingGambits(): what the panel adds to a gambit roll, run against a
// stand-in for the system's RollForm.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { panel } from "./foundry.mjs";

const { resolveMissingGambits } = panel;

/**
 * Shaped like the system's RollForm: _resolveGambit handles six gambits and
 * lets the rest fall straight through, and _addEndofRoundDefensePenalty pushes
 * the same effect the system pushes.
 */
function makeForm(gambit, targetType = "character") {
  const attacker = {
    type: "character", name: "Rising Tide", uuid: "Actor.attacker", effects: [],
    async createEmbeddedDocuments(type, docs) {
      attacker.effects.push(...docs.map((d) => ({ ...d, statuses: new Set(d.statuses) })));
    }
  };
  return {
    actor: attacker,
    object: {
      gambit,
      target: { actor: { type: targetType, uuid: "Actor.target" } },
      newTargetData: { effects: [] },
      addStatuses: [],
      updateTargetActorData: false
    },
    _resolveGambit(extra = 0) {
      this.object.updateTargetActorData = true;
      switch (this.object.gambit) {
        case "disarm": this.object.addStatuses.push("disarmed"); break;
        case "knockdown": this.object.addStatuses.push("prone"); break;
        case "ensnare": this.object.addStatuses.push("ensnared"); break;
        case "reveal_weakness":
          this.object.newTargetData.effects.push({ name: "Reveal Weakness" });
          break;
        case "pull": this._addEndofRoundDefensePenalty(extra); break;
        case "distract": this._addEndofRoundDefensePenalty(extra + 1); break;
      }
    },
    _addEndofRoundDefensePenalty(value) {
      this.object.newTargetData.effects.push({
        name: `Defense Penalty (${-value})`,
        duration: { rounds: 1 },
        flags: { exaltedessence: { statusId: "end_of_round" } },
        changes: [{ key: "system.evasion.value", value: -value, mode: 2 }]
      });
    }
  };
}

function resolve(gambit, extra, targetType) {
  const form = makeForm(gambit, targetType);
  resolveMissingGambits(form);
  form._resolveGambit(extra);
  return form;
}

const penalties = (form) => form.object.newTargetData.effects.filter(
  (e) => e.flags?.exaltedessence?.statusId === "end_of_round");

test("gambits the system resolves are left exactly as the system leaves them", () => {
  const knockdown = resolve("knockdown", 2);
  assert.deepEqual(knockdown.object.addStatuses, ["prone"]);
  assert.equal(knockdown.object.newTargetData.effects.length, 0);
  assert.equal(penalties(resolve("distract", 2))[0].changes[0].value, -3);
  assert.equal(penalties(resolve("pull", 2))[0].changes[0].value, -2);
});

test("Knockback costs the target 1 Defense per extra success", () => {
  const found = penalties(resolve("knockback", 2));
  assert.equal(found.length, 1);
  assert.equal(found[0].changes[0].value, -2);
});

test("Knockback with no extra successes applies nothing, not a -0 penalty", () => {
  assert.equal(resolve("knockback", 0).object.newTargetData.effects.length, 0);
});

test("Grapple gives the target one effect carrying both the status and the -1", () => {
  const form = resolve("grapple", 1);
  const effects = form.object.newTargetData.effects;
  assert.equal(effects.length, 1);
  assert.deepEqual(effects[0].statuses, ["grappling"]);
  assert.deepEqual(effects[0].changes.map((c) => [c.key, c.value]),
    [["system.evasion.value", -1], ["system.parry.value", -1]]);
  assert.equal(form.object.updateTargetActorData, true);
  // Not the plain status: the roller checks e.name === 'grappling', Foundry
  // names the status "Grappling", so a status alone would cost nothing.
  assert.equal(form.object.addStatuses.includes("grappling"), false);
});

test("an antagonist's grapple penalty goes on its single Defense", () => {
  const [effect] = resolve("grapple", 1, "npc").object.newTargetData.effects;
  assert.deepEqual(effect.changes.map((c) => [c.key, c.value]),
    [["system.defense.value", -1]]);
});

test("if the system grows a Knockback case of its own, there is no second penalty", () => {
  const form = makeForm("knockback");
  const own = form._resolveGambit.bind(form);
  form._resolveGambit = function (extra) {
    own(extra);
    this._addEndofRoundDefensePenalty(extra);
  };
  resolveMissingGambits(form);
  form._resolveGambit(2);
  assert.equal(penalties(form).length, 1);
});

test("a target already grappling gets no second effect", () => {
  const form = makeForm("grapple");
  form.object.newTargetData.effects.push({ name: "Grappling", statuses: ["grappling"] });
  form.actor.effects.push({ name: "Grappling", statuses: new Set(["grappling"]) });
  resolveMissingGambits(form);
  form._resolveGambit(1);
  assert.equal(form.object.newTargetData.effects.length, 1);
});

test("a system without _resolveGambit is reported, not silently skipped", () => {
  const warn = mock.method(console, "warn", () => {});
  resolveMissingGambits({ object: {}, actor: null });
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /_resolveGambit is missing/);
  warn.mock.restore();
});
