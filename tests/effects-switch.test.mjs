// "Cinematic effects": one switch that turns every effect off at once, and
// leaves each effect's own setting as it was for when it comes back on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings } from "./foundry.mjs";

const {
  effectEnabled, impactAllowed, shouldShowCutIn, shouldShowDecisive, breakEffectTokens,
  defeatEffectTokens, defeatCombatantTokens, poiseNumberTokens, startsFight, endsFight,
  splashedCombats, wantedAuras, shouldShowCallouts, shouldShowGambitCallout, shouldShowFlare
} = panel;

const MASTER = "essence-poise-break.cinematicEffects";
const EFFECTS = [
  "breakEffect", "decisiveCutIn", "hitImpact", "defeatedFinisher", "poiseNumbers",
  "charmCallouts", "gambitCallouts", "animaFlare", "bonfireAura", "roundSplash", "finaleSplash"
];

const scene = { id: "here" };
const seen = { id: "tok", isVisible: true, destroyed: false };
const board = { scene, tokens: { get: () => seen, placeables: [] } };

/** Every effect's "would it play?" for this client, by name. */
function everything() {
  globalThis.canvas = board;
  splashedCombats.clear();
  const on = (list) => list.length > 0;
  const statusEffect = (id) => ({ statuses: new Set([id]), parent: { getActiveTokens: () => [seen] } });
  const burning = { id: "tok", actor: { system: { anima: { level: "bonfire" } } } };
  const payload = { tokenId: "tok", sceneId: "here", name: "X", charms: ["Y"], level: "bonfire" };
  const won = {
    id: "c", round: 2, scene,
    combatants: [
      { actor: { hasPlayerOwner: true, statuses: new Set() }, token: { disposition: 1 } },
      { isDefeated: true, actor: { statuses: new Set() }, token: { disposition: -1 } }
    ]
  };
  return {
    breakEffect: on(breakEffectTokens(statusEffect("break"))),
    decisiveCutIn: shouldShowCutIn(payload),
    hitImpact: impactAllowed(),
    decisive: shouldShowDecisive(payload),
    defeatedFinisher: on(defeatEffectTokens(statusEffect("incapacitated"))),
    defeatedFromTracker: on(defeatCombatantTokens({ token: { object: seen } }, { defeated: true })),
    poiseNumbers: on(poiseNumberTokens({ getActiveTokens: () => [seen] })),
    charmCallouts: shouldShowCallouts(payload),
    gambitCallouts: shouldShowGambitCallout(payload),
    animaFlare: shouldShowFlare(payload),
    bonfireAura: wantedAuras([burning]).size > 0,
    roundSplash: startsFight({ id: "c", scene }, { round: 1 }, { board }),
    finaleSplash: endsFight(won, { board }) === "victory"
  };
}

test("with the switch on, every effect follows its own setting", () => {
  settings.set(MASTER, true);
  for (const [name, plays] of Object.entries(everything())) assert.equal(plays, true, name);
});

test("with the switch off, nothing plays", () => {
  settings.set(MASTER, false);
  try {
    for (const [name, plays] of Object.entries(everything())) assert.equal(plays, false, name);
    for (const key of EFFECTS) assert.equal(effectEnabled(key), false, key);
  } finally {
    settings.set(MASTER, true);
  }
});

test("switching off leaves each effect's own setting as it was", () => {
  settings.set(`essence-poise-break.poiseNumbers`, false);
  settings.set(MASTER, false);
  settings.set(MASTER, true);
  assert.equal(effectEnabled("poiseNumbers"), false, "an effect turned off stays off");
  assert.equal(effectEnabled("breakEffect"), true, "an effect left on comes back on");
  settings.set(`essence-poise-break.poiseNumbers`, true);
});

test("the switch does not touch the panel's own rules", () => {
  settings.set(MASTER, false);
  try {
    assert.equal(game.settings.get("essence-poise-break", "clearGambitEffects"), true);
    assert.equal(game.settings.get("essence-poise-break", "autoOpen"), true);
  } finally {
    settings.set(MASTER, true);
  }
});

test("an effect setting that cannot be read counts as off", () => {
  const get = game.settings.get;
  game.settings.get = () => { throw new Error("not registered yet"); };
  try {
    assert.equal(effectEnabled("breakEffect"), false);
  } finally {
    game.settings.get = get;
  }
});
