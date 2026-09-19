/**
 * Poise & Break - The ROUND 1, FIGHT! splash and the VICTORY / DEFEAT finale.
 */

import { MODULE_ID } from "./core.js";
import { defeatStatuses } from "./defeated.js";
import { esc } from "./rules.js";
import { photosensitive } from "./break-effect.js";

/* -------------------------------------------- */
/*  The ROUND 1, FIGHT! splash                  */
/* -------------------------------------------- */

/**
 * The splash: as a combat starts, a fighting game's opening crosses every
 * screen - a band snaps open, ROUND 1 slides through it, and FIGHT! slams
 * down. It plays once per fight, on the move into round one, so unlike a
 * banner on every turn it never wears thin.
 *
 * Starting a combat updates it to round one, and that update reaches every
 * client, so nothing is sent: each plays it for itself, if it is looking at
 * the scene the fight is on. Stepping back into round one later does not play
 * it again; resetting the combat to round zero lets it play once more.
 */
/** Matched by the animations in styles/splash.css. */
const SPLASH_DURATION = 2400;
const SPLASH_DURATION_GENTLE = 2600;

function showingSplash() {
  try {
    return !!game.settings.get(MODULE_ID, "roundSplash");
  } catch (err) {
    return false;
  }
}

/** The fights that have had their splash on this client. */
const splashedCombats = new Set();

/**
 * Does this update start the fight, for this client? Round one reached for
 * the first time, on the scene this client is looking at - or a combat tied to
 * no scene at all. A combat sent back to round zero may play it again.
 */
function startsFight(combat, changed, { board = globalThis.canvas } = {}) {
  if (!combat?.id || !changed || !Object.hasOwn(changed, "round")) return false;
  if (changed.round === 0) {
    splashedCombats.delete(combat.id);
    return false;
  }
  if (changed.round !== 1 || splashedCombats.has(combat.id)) return false;
  splashedCombats.add(combat.id);
  if (!showingSplash()) return false;
  let sceneId = null;
  try {
    sceneId = combat.scene?.id ?? null;
  } catch (err) {
    sceneId = null;
  }
  if (sceneId && board?.scene?.id !== sceneId) return false;
  return true;
}

function splashMarkup({ gentle = false } = {}) {
  return `<div class="epb-splash"${gentle ? ` data-gentle="true"` : ""} aria-hidden="true">
    <div class="epb-splash-band"></div>
    <div class="epb-splash-round">Round 1</div>
    <div class="epb-splash-fight">Fight!</div>
  </div>`;
}

/** The splash on screen now, so a second replaces it rather than stacking. */
let splashShowing = null;

/** Put the splash on this client's screen, then take it down. */
function playSplash({ doc = globalThis.document } = {}) {
  if (!doc?.body) return null;
  const reducedMotion = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const gentle = photosensitive() || reducedMotion;
  splashShowing?.remove();
  const layer = doc.createElement("div");
  layer.className = "epb-splash-layer";
  layer.innerHTML = splashMarkup({ gentle });
  doc.body.append(layer);
  splashShowing = layer;
  setTimeout(() => {
    layer.remove();
    if (splashShowing === layer) splashShowing = null;
  }, gentle ? SPLASH_DURATION_GENTLE : SPLASH_DURATION);
  return layer;
}

/* -------------------------------------------- */
/*  The VICTORY / DEFEAT finale                 */
/* -------------------------------------------- */

/**
 * The finale: as the Storyteller ends a combat, VICTORY crosses every screen
 * if every foe in it is down, or DEFEAT if every one of the party is. A fight
 * that ends any other way - foes fleeing, a parley, the Storyteller calling it
 * early - ends quietly, since the module cannot tell who won it.
 *
 * Sides come from the tracker: a player's character, or a token set Friendly,
 * is the party; a token set Hostile, or Secret, is a foe; Neutral is neither.
 * Down is what the DEFEATED finisher plays on - marked defeated in the tracker,
 * Incapacitated, or Foundry's defeated status.
 *
 * Ending a combat deletes it, and every client is told, with the combat still
 * in hand, so nothing is sent.
 */
/** Matched by the finale's animations in styles/splash.css. */
const FINALE_DURATION = 2800;

function showingFinale() {
  try {
    return !!game.settings.get(MODULE_ID, "finaleSplash");
  } catch (err) {
    return false;
  }
}

/** Is this combatant out of the fight? */
function combatantDown(combatant) {
  if (!combatant) return false;
  if (combatant.isDefeated || combatant.defeated) return true;
  const statuses = combatant.actor?.statuses;
  return !!statuses?.has && defeatStatuses().some((id) => statuses.has(id));
}

/** "party", "foes", or null for a combatant on neither side. */
function combatantSide(combatant) {
  if (combatant?.actor?.hasPlayerOwner) return "party";
  const disposition = combatant?.token?.disposition;
  const kinds = globalThis.CONST?.TOKEN_DISPOSITIONS ?? {};
  if (disposition === (kinds.FRIENDLY ?? 1)) return "party";
  if (disposition === (kinds.HOSTILE ?? -1) || disposition === (kinds.SECRET ?? -2)) return "foes";
  return null;
}

function combatantsOf(combat) {
  const combatants = combat?.combatants;
  if (!combatants) return [];
  return Array.isArray(combatants) ? combatants : Array.from(combatants.contents ?? combatants);
}

/**
 * How a fight ended: "victory", "defeat", or null when it was not decided. A
 * combat that never began has no outcome, and neither does a side with nobody
 * on it. If both sides fell, the party's fall is the one that counts.
 */
function fightOutcome(combat) {
  if (!combat || !(Number(combat.round) >= 1)) return null;
  const combatants = combatantsOf(combat);
  const party = combatants.filter((c) => combatantSide(c) === "party");
  const foes = combatants.filter((c) => combatantSide(c) === "foes");
  if (party.length && party.every(combatantDown)) return "defeat";
  if (foes.length && foes.every(combatantDown)) return "victory";
  return null;
}

/** The outcome to show on this client as a combat ends, or null. */
function endsFight(combat, { board = globalThis.canvas } = {}) {
  if (!showingFinale()) return null;
  const outcome = fightOutcome(combat);
  if (!outcome) return null;
  let sceneId = null;
  try {
    sceneId = combat.scene?.id ?? null;
  } catch (err) {
    sceneId = null;
  }
  if (sceneId && board?.scene?.id !== sceneId) return null;
  return outcome;
}

/** The line under the word: how long it took, or who fell. */
function finaleSubline(outcome, rounds) {
  if (outcome === "defeat") return "The party has fallen";
  const count = Math.max(1, Math.floor(Number(rounds) || 1));
  return `In ${count} ${count === 1 ? "round" : "rounds"}`;
}

function finaleMarkup(outcome, { rounds = 1, gentle = false } = {}) {
  const defeat = outcome === "defeat";
  return `<div class="epb-finale" data-outcome="${defeat ? "defeat" : "victory"}"${
    gentle ? ` data-gentle="true"` : ""} aria-hidden="true">
    <div class="epb-finale-rays"></div>
    <div class="epb-finale-band"></div>
    <div class="epb-finale-word">${defeat ? "Defeat" : "Victory"}</div>
    <div class="epb-finale-sub">${esc(finaleSubline(outcome, rounds))}</div>
  </div>`;
}

/** Put the finale on this client's screen, replacing a splash still up, then take it down. */
function playFinale(outcome, { rounds = 1, doc = globalThis.document } = {}) {
  if (!outcome || !doc?.body) return null;
  const reducedMotion = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const gentle = photosensitive() || reducedMotion;
  splashShowing?.remove();
  const layer = doc.createElement("div");
  layer.className = "epb-splash-layer";
  layer.innerHTML = finaleMarkup(outcome, { rounds, gentle });
  doc.body.append(layer);
  splashShowing = layer;
  setTimeout(() => {
    layer.remove();
    if (splashShowing === layer) splashShowing = null;
  }, FINALE_DURATION);
  return layer;
}

export {
  FINALE_DURATION,
  SPLASH_DURATION,
  SPLASH_DURATION_GENTLE,
  combatantDown,
  combatantSide,
  combatantsOf,
  endsFight,
  fightOutcome,
  finaleMarkup,
  finaleSubline,
  playFinale,
  playSplash,
  showingFinale,
  showingSplash,
  splashMarkup,
  splashShowing,
  splashedCombats,
  startsFight
};
