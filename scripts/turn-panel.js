/**
 * Poise & Break — Turn Panel
 *
 * Shows, on your turn, only the attacks that are legal against your current
 * target, and hands the roll to the system's own dice roller.
 *
 * Nothing here rolls dice or applies damage. Every button calls the Exalted
 * Essence system through the API it already exposes for hotbar macros:
 *
 *   game.exaltedessence.weaponAttack(itemUuid, "withering" | "decisive" | "gambit")
 *   new game.exaltedessence.RollForm(actor, options, {}, { rollType }).render(true)
 *
 * The exceptions are all gambits. Knockback and Grapple fall through the
 * system's own gambit resolution and apply nothing, so the panel supplies their
 * Defense penalty - pushing into the arrays the system is about to read rather
 * than writing to the target itself (resolveMissingGambits). And the timed
 * effects gambits leave behind are cleared once their round is over, because
 * nothing else ever removes them (sweepGambitEffects).
 *
 * Legality comes from the target's own token: the system registers "break" as
 * a status effect and clears it itself once Poise is restored, so reading that
 * status is enough to know which attack applies.
 */

import { AnimaColorFiller } from "./anima-colors.js";
import { CUT_IN_SOCKET, receiveCutIn, wrapAttackSequence } from "./cut-in.js";
import { MODULE_ID, SYSTEM_ID, VERIFIED_SYSTEM } from "./core.js";
import { TurnPanel } from "./panel.js";
import { animaAfterUpdate, receiveAnimaFlare, recordAnimaBefore } from "./anima-flare.js";
import { breakEffectTokens, playBreakEffect, quietCoreBreakText } from "./break-effect.js";
import { clearAuras, syncAurasSafely } from "./bonfire-aura.js";
import { defeatCombatantTokens, defeatEffectTokens, playDefeats } from "./defeated.js";
import { endsFight, playFinale, playSplash, startsFight } from "./splash.js";
import { poiseAfterUpdate, rememberCanvasPoise, rememberPoise } from "./poise-numbers.js";
import { receiveCallouts, receiveGambitCallout, wrapResolveGambit, wrapRollerResources, wrapSpendItem } from "./callouts.js";
import { roundAdvanced, stampGambitEffect, sweepGambitEffects } from "./gambits.js";

/* -------------------------------------------- */
/*  Wiring                                      */
/* -------------------------------------------- */

let panel = null;

function openPanel(actor) {
  if (!actor) return null;
  if (panel?.rendered && panel.actor?.id === actor.id) {
    panel.render();
    return panel;
  }
  panel?.close();
  panel = new TurnPanel(actor);
  panel.render(true);
  return panel;
}

function refreshPanel() {
  if (panel?.rendered) panel.render();
}

/**
 * Whose turn opens the panel: a player gets their own characters, and the
 * Storyteller gets the characters nobody else owns. Without that split the GM
 * would get a panel on every player's turn as well.
 */
function shouldOpenFor(actor) {
  if (!actor?.isOwner) return false;
  if (game.user.isGM) return !actor.hasPlayerOwner;
  return true;
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "explain", {
    name: "Explain the rule",
    hint: "Shows the rule behind each recommendation. Turn off once the table knows Combat Reforged.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "controlSpells", {
    name: "Control spells are in play",
    hint: "An optional rule from the Storyteller's Guide: a sorcerer's control "
      + "spell costs 1 less Will. Tick 'Is Control Spell' on the spell itself; "
      + "the panel then shows the reduced cost. Off unless your table uses it.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "clearGambitEffects", {
    name: "Clear gambit effects when they run out",
    hint: "Distract, Pull and Knockback lower Defense for the rest of the round; "
      + "Reveal Weakness cuts Soak for a number of rounds. Nothing in the system "
      + "removes them, and it records no start round, so Foundry can switch "
      + "them off early. With this on, the Storyteller's client records when "
      + "each began and deletes it once its time is up.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "cinematicEffects", {
    name: "Cinematic effects",
    hint: "Every effect below at once: BREAK, the cut-in, hit-stop, DEFEATED, "
      + "Poise numbers, callouts, the anima flare and aura, and the round "
      + "splashes. Turn this off for a quiet session or a slow machine; each "
      + "effect keeps its own setting for when it comes back on.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => syncAurasSafely()
  });

  game.settings.register(MODULE_ID, "breakEffect", {
    name: "Show the Break effect",
    hint: "Shatters a token's Poise and slams the word BREAK over it the moment "
      + "it Breaks. With Foundry's photosensitive mode on, it is a faint ring "
      + "and a slow fade instead. Turn this off to hide it.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "decisiveCutIn", {
    name: "Show the decisive cut-in",
    hint: "When a decisive attack lands, the attacker's portrait cuts in across "
      + "the screen in their anima colour, with the Charms they used. It plays "
      + "for attackers you can see on the map. With Foundry's photosensitive "
      + "mode or reduced motion on, it fades in and out instead. Turn this off "
      + "to hide it.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "hitImpact", {
    name: "Hit-stop and screen shake",
    hint: "When a decisive attack lands, the map freezes for a split second on "
      + "a stark frame, then the screen jolts as the cut-in plays. It plays for "
      + "attackers you can see on the map. It is left out with Foundry's "
      + "photosensitive mode or reduced motion on. Turn this off to hide it.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "defeatedFinisher", {
    name: "Show the DEFEATED finisher",
    hint: "When a character is marked Incapacitated or defeated, the world slows "
      + "and drains of colour and DEFEATED falls onto their token. It plays for "
      + "tokens you can see. With Foundry's photosensitive mode or reduced motion "
      + "on, the word only fades in and out, with no slowing or draining. Turn "
      + "this off to hide it.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "poiseNumbers", {
    name: "Show Poise damage numbers",
    hint: "When a token's Poise falls, the amount pops off it - jade while they "
      + "still stand, red on the hit that Breaks them - and Poise coming back "
      + "in Break shows as a paler plus. It shows on tokens you can see. With "
      + "Foundry's photosensitive mode on, the numbers fade in and out instead. "
      + "Turn this off to hide them.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "charmCallouts", {
    name: "Show Charm callouts",
    hint: "When a character uses a Charm, in a roll or from their sheet, its "
      + "name bursts from their token. It plays for tokens you can see. With "
      + "Foundry's photosensitive mode on, the names fade in and out instead. "
      + "Turn this off to hide them.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "gambitCallouts", {
    name: "Show gambit callouts",
    hint: "When a gambit lands, its name bursts from the attacker's token in "
      + "orichalcum - DISARM!, KNOCKBACK! It plays for tokens you can see, and "
      + "names an antagonist's gambits too, since everyone sees them happen. "
      + "With Foundry's photosensitive mode on, the name fades in and out "
      + "instead. Turn this off to hide them.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "revealStorytellerCharms", {
    name: "Name the Storyteller's Charms",
    hint: "An antagonist's decisive cut-in and Charm callouts keep the names of "
      + "the Charms it uses from the players, who may not know what it can do. "
      + "Turn this on to name them for everyone.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "animaFlare", {
    name: "Show the anima flare",
    hint: "When a character's anima rises into Bonfire or Iconic, a column of "
      + "light in their anima colour erupts from their token, with a caption "
      + "on screen. It plays for tokens you can see. With Foundry's "
      + "photosensitive mode on, it is a slow, faint column with no flash. "
      + "Turn this off to hide it.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "bonfireAura", {
    name: "Show the Bonfire aura",
    hint: "While a character's anima is at Bonfire or Iconic, flames in their "
      + "anima colour burn round their token, and die away when it falls. It "
      + "shows on tokens you can see. With Foundry's photosensitive mode on, it "
      + "is a slow, faint glow with no flames. Turn this off to hide it.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => syncAurasSafely()
  });

  // The Storyteller's button, below the settings above.
  game.settings.registerMenu(MODULE_ID, "fillAnimaColors", {
    name: "Anima colours on sheets",
    label: "Fill in anima colours",
    hint: "Writes the colour this module matches to each character - from their "
      + "caste, their anima, or their Exalt type - into every sheet still on the "
      + "system's default white, so the system's own anima glow matches these "
      + "effects. A colour already picked is never touched, and the window lists "
      + "what it will change before writing anything.",
    icon: "fa-solid fa-palette",
    type: AnimaColorFiller,
    restricted: true
  });

  game.settings.register(MODULE_ID, "roundSplash", {
    name: "Show the ROUND 1, FIGHT! splash",
    hint: "As a combat starts, ROUND 1 and FIGHT! cross the screen the way a "
      + "fighting game opens a round - once per fight, on the scene you are "
      + "looking at. With Foundry's photosensitive mode or reduced motion on, "
      + "it fades in and out instead. Turn this off to hide it.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "finaleSplash", {
    name: "Show the VICTORY / DEFEAT finale",
    hint: "As the Storyteller ends a combat, VICTORY crosses the screen if every "
      + "foe in it is down, or DEFEAT if the whole party is. A fight that ends "
      + "any other way ends quietly. Foes are tokens set Hostile or Secret; the "
      + "party is player characters and tokens set Friendly. With Foundry's "
      + "photosensitive mode or reduced motion on, it fades in and out instead. "
      + "Turn this off to hide it.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoOpen", {
    name: "Open automatically on your turn",
    hint: "Opens the panel when a combat turn reaches a character you control.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", () => {
  if (game.system.id !== SYSTEM_ID) return;

  // A manual way in, for a macro or a keybinding:
  //   game.modules.get("essence-poise-break").api.open()
  game.modules.get(MODULE_ID).api = {
    open: (actor) =>
      openPanel(
        actor ??
          game.combat?.combatant?.actor ??
          canvas.tokens?.controlled?.[0]?.actor ??
          game.user.character
      ),
    close: () => panel?.close()
  };

  if (game.system.version !== VERIFIED_SYSTEM) {
    console.log(
      `${MODULE_ID} | condition maths were verified against ${SYSTEM_ID} `
      + `${VERIFIED_SYSTEM}; this world runs ${game.system.version}. If a panel `
      + "number ever disagrees with a roll, the panel will say so."
    );
  }

  Hooks.on("updateCombat", (combat) => {
    const actor = combat.combatant?.actor;
    if (!actor) return;
    if (!game.settings.get(MODULE_ID, "autoOpen")) return;
    if (shouldOpenFor(actor)) openPanel(actor);
    else refreshPanel();
  });

  Hooks.on("deleteCombat", () => panel?.close());

  // The VICTORY / DEFEAT finale, as a decided combat is ended.
  Hooks.on("deleteCombat", (combat) => {
    try {
      const outcome = endsFight(combat);
      if (outcome) playFinale(outcome, { rounds: combat.round });
    } catch (err) {
      console.warn(`${MODULE_ID} | could not play the finale`, err);
    }
  });

  // The ROUND 1, FIGHT! splash, as a combat reaches round one.
  Hooks.on("updateCombat", (combat, changed) => {
    try {
      if (startsFight(combat, changed)) playSplash();
    } catch (err) {
      console.warn(`${MODULE_ID} | could not play the round splash`, err);
    }
  });

  // Gambit effects that last the rest of the round, or a few rounds: record
  // when each began, since the roller does not, and clear each once it is over.
  Hooks.on("createActiveEffect", (effect) => stampGambitEffect(effect));
  Hooks.on("updateCombat", (combat, changed) => {
    if (roundAdvanced(combat, changed)) sweepGambitEffects(combat);
  });
  Hooks.on("deleteCombat", (combat) => sweepGambitEffects(combat, { ended: true }));

  // The moment a token Breaks, its Poise shatters off it - on every client that
  // can see it, however the status was applied.
  Hooks.on("createActiveEffect", (effect) => {
    for (const token of breakEffectTokens(effect)) playBreakEffect(token);
  });

  // The DEFEATED finisher, as a status that takes a character out lands or the
  // combat tracker marks them defeated - on every client that can see them.
  Hooks.on("createActiveEffect", (effect) => {
    try {
      playDefeats(defeatEffectTokens(effect));
    } catch (err) {
      console.warn(`${MODULE_ID} | could not play the DEFEATED finisher`, err);
    }
  });
  Hooks.on("updateCombatant", (combatant, changed) => {
    try {
      playDefeats(defeatCombatantTokens(combatant, changed));
    } catch (err) {
      console.warn(`${MODULE_ID} | could not play the DEFEATED finisher`, err);
    }
  });

  // Foundry's own small "+(Break)" would say the same thing as the BREAK text.
  quietCoreBreakText();

  // The decisive cut-in. The roller's attack step plays it on the client that
  // rolled and sends it to the rest, who each decide whether to show it.
  wrapAttackSequence(game.exaltedessence?.RollForm);

  // One socket for the module; each receiver ignores messages that aren't its.
  game.socket?.on(CUT_IN_SOCKET, (message) => {
    receiveCutIn(message);
    receiveAnimaFlare(message);
    receiveCallouts(message);
    receiveGambitCallout(message);
  });

  // Charm callouts: the roller paying for a roll's Charms, and the actor
  // spending one from the sheet.
  wrapRollerResources(game.exaltedessence?.RollForm);
  wrapSpendItem(CONFIG.Actor?.documentClass);

  // Gambit callouts: the roller resolving a gambit that has landed.
  wrapResolveGambit(game.exaltedessence?.RollForm);

  // The anima flare. The client changing an actor notes its anima level first
  // and compares once the system has worked out the new one. preUpdateActor is
  // called with Hooks.call, where a handler returning false cancels the update,
  // so this handler returns nothing at all.
  Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
    try {
      recordAnimaBefore(actor, changes, userId);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not note anima before an update`, err);
    }
  });
  Hooks.on("updateActor", (actor, changed, options, userId) => {
    animaAfterUpdate(actor, userId);
  });

  // The Bonfire aura, on every client: whatever could start or stop a token
  // burning, or move it to another scene, brings the auras back into line.
  Hooks.on("canvasReady", syncAurasSafely);

  // Poise damage numbers, on every client: remember each token's Poise as it
  // is drawn, and show the difference when an update changes it.
  Hooks.on("canvasReady", () => rememberCanvasPoise());
  Hooks.on("drawToken", (token) => rememberPoise(token?.actor));
  Hooks.on("updateActor", (actor, changed) => {
    try {
      poiseAfterUpdate(actor, changed);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not show the Poise change`, err);
    }
  });
  if (globalThis.canvas?.ready) rememberCanvasPoise();
  Hooks.on("canvasTearDown", clearAuras);
  Hooks.on("updateActor", syncAurasSafely);
  Hooks.on("drawToken", syncAurasSafely);
  Hooks.on("deleteToken", syncAurasSafely);
  if (globalThis.canvas?.ready) syncAurasSafely();

  // Targeting, Break being toggled, and Power or Poise changing all alter what
  // the panel should be offering, so each one re-renders it.
  Hooks.on("targetToken", refreshPanel);
  Hooks.on("updateActor", refreshPanel);
  Hooks.on("createActiveEffect", refreshPanel);
  Hooks.on("deleteActiveEffect", refreshPanel);
  // An effect being switched on or off fires update, not create or delete, so
  // without this a charm toggled mid-combat left the panel showing stale
  // numbers.
  Hooks.on("updateActiveEffect", refreshPanel);
  Hooks.on("updateToken", refreshPanel);
  Hooks.on("updateItem", refreshPanel);
});

/* -------------------------------------------- */
/*  For the tests                               */
/* -------------------------------------------- */

// Foundry loads this file as a module and ignores what it exports; the tests
// in tests/ import it under a stubbed Foundry and need the pieces by name, so
// every part of the module is re-exported from here.
export * from "./core.js";
export * from "./rules.js";
export * from "./gambits.js";
export * from "./break-effect.js";
export * from "./cut-in.js";
export * from "./defeated.js";
export * from "./poise-numbers.js";
export * from "./splash.js";
export * from "./anima-colors.js";
export * from "./anima-flare.js";
export * from "./bonfire-aura.js";
export * from "./callouts.js";
export * from "./panel.js";
