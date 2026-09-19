// The VICTORY / DEFEAT finale: who is on which side, who is down, how a fight
// ended, and what goes on the screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings } from "./foundry.mjs";

const {
  combatantDown, combatantSide, fightOutcome, endsFight, finaleSubline, finaleMarkup,
  playFinale, FINALE_DURATION
} = panel;

const HOSTILE = -1;
const FRIENDLY = 1;
const NEUTRAL = 0;
const SECRET = -2;

function fighter({ player = false, disposition = HOSTILE, down = false, statuses = [] } = {}) {
  return {
    isDefeated: down,
    actor: { hasPlayerOwner: player, statuses: new Set(statuses) },
    token: { disposition }
  };
}
const hero = (opts = {}) => fighter({ player: true, disposition: FRIENDLY, ...opts });
const foe = (opts = {}) => fighter({ disposition: HOSTILE, ...opts });
const fight = (combatants, { round = 3, sceneId = "here" } = {}) =>
  ({ id: "c", round, combatants, scene: sceneId ? { id: sceneId } : null });
const board = { scene: { id: "here" } };

/* ------------------------------- sides ------------------------------- */

test("player characters and Friendly tokens are the party; Hostile and Secret are foes", () => {
  assert.equal(combatantSide(hero()), "party");
  assert.equal(combatantSide(fighter({ disposition: FRIENDLY })), "party", "a friendly ally");
  assert.equal(combatantSide(fighter({ player: true, disposition: HOSTILE })), "party",
    "a player's character counts as the party whatever its token says");
  assert.equal(combatantSide(foe()), "foes");
  assert.equal(combatantSide(fighter({ disposition: SECRET })), "foes");
  assert.equal(combatantSide(fighter({ disposition: NEUTRAL })), null);
  assert.equal(combatantSide({}), null);
});

test("down is marked defeated, Incapacitated, or Foundry's defeated status", () => {
  CONFIG.specialStatusEffects = { DEFEATED: "dead" };
  assert.equal(combatantDown(foe({ down: true })), true);
  assert.equal(combatantDown(foe({ statuses: ["incapacitated"] })), true);
  assert.equal(combatantDown(foe({ statuses: ["dead"] })), true);
  assert.equal(combatantDown(foe({ statuses: ["break", "prone"] })), false, "Broken is not out");
  assert.equal(combatantDown(foe()), false);
  assert.equal(combatantDown(null), false);
});

/* ------------------------------ outcomes ------------------------------ */

test("every foe down is a victory", () => {
  assert.equal(fightOutcome(fight([hero(), foe({ down: true }), foe({ statuses: ["incapacitated"] })])), "victory");
});

test("the whole party down is a defeat, even if the foes fell too", () => {
  assert.equal(fightOutcome(fight([hero({ down: true }), foe()])), "defeat");
  assert.equal(fightOutcome(fight([hero({ down: true }), foe({ down: true })])), "defeat");
});

test("a fight ended with both sides still standing is undecided", () => {
  assert.equal(fightOutcome(fight([hero(), foe(), foe({ down: true })])), null);
});

test("neutral bystanders do not hold up a victory", () => {
  assert.equal(fightOutcome(fight([hero(), foe({ down: true }), fighter({ disposition: NEUTRAL })])), "victory");
});

test("a side with nobody on it decides nothing", () => {
  assert.equal(fightOutcome(fight([hero()])), null, "no foes to beat");
  assert.equal(fightOutcome(fight([foe({ down: true }), fighter({ disposition: NEUTRAL })])), "victory");
  assert.equal(fightOutcome(fight([])), null);
});

test("a combat that never began has no outcome", () => {
  assert.equal(fightOutcome(fight([hero(), foe({ down: true })], { round: 0 })), null);
  assert.equal(fightOutcome(null), null);
});

test("combatants arrive however Foundry holds them", () => {
  const combatants = [hero(), foe({ down: true })];
  assert.equal(fightOutcome(fight({ contents: combatants })), "victory");
  assert.equal(fightOutcome(fight(new Set(combatants))), "victory");
});

/* ---------------------------- who sees it ---------------------------- */

test("it shows on the fight's scene, or anywhere for a fight tied to none", () => {
  const won = [hero(), foe({ down: true })];
  assert.equal(endsFight(fight(won), { board }), "victory");
  assert.equal(endsFight(fight(won, { sceneId: "elsewhere" }), { board }), null);
  assert.equal(endsFight(fight(won, { sceneId: null }), { board }), "victory");
});

test("with the setting off it does not show", () => {
  settings.set("essence-poise-break.finaleSplash", false);
  assert.equal(endsFight(fight([hero(), foe({ down: true })]), { board }), null);
  settings.set("essence-poise-break.finaleSplash", true);
});

/* ------------------------------ the screen ----------------------------- */

test("victory says how many rounds it took; defeat says who fell", () => {
  assert.equal(finaleSubline("victory", 1), "In 1 round");
  assert.equal(finaleSubline("victory", 4), "In 4 rounds");
  assert.equal(finaleSubline("victory", undefined), "In 1 round");
  assert.equal(finaleSubline("defeat", 4), "The party has fallen");
});

test("the markup carries the word and its outcome", () => {
  const won = finaleMarkup("victory", { rounds: 3 });
  assert.match(won, /data-outcome="victory"/);
  assert.match(won, />Victory</);
  assert.match(won, />In 3 rounds</);
  const lost = finaleMarkup("defeat");
  assert.match(lost, /data-outcome="defeat"/);
  assert.match(lost, />Defeat</);
  assert.match(finaleMarkup("victory", { gentle: true }), /data-gentle="true"/);
  assert.match(finaleMarkup("anything else"), /data-outcome="victory"/, "only defeat is defeat");
});

function fakeDocument() {
  const body = { children: [], append(el) { this.children.push(el); } };
  return {
    body,
    createElement: () => ({
      className: "", innerHTML: "",
      remove() { const at = body.children.indexOf(this); if (at !== -1) body.children.splice(at, 1); }
    })
  };
}

test("it goes on screen in place of a splash still showing", () => {
  const doc = fakeDocument();
  panel.playSplash({ doc });
  const layer = playFinale("victory", { rounds: 2, doc });
  assert.deepEqual(doc.body.children, [layer]);
  assert.match(layer.innerHTML, /Victory/);
  assert.equal(playFinale(null, { doc }), null);
  assert.equal(playFinale("victory", { doc: {} }), null);
  assert.ok(FINALE_DURATION >= 2000 && FINALE_DURATION <= 3500);
});

test("photosensitive mode gets the gentle version", () => {
  const doc = fakeDocument();
  settings.set("core.photosensitiveMode", true);
  assert.match(playFinale("defeat", { doc }).innerHTML, /data-gentle="true"/);
  settings.delete("core.photosensitiveMode");
});
