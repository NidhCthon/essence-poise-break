/**
 * Poise & Break - Reading the target's state: what is legal against them, the
 * numbers the roller will use, and what each gambit costs.
 */

import { PANEL_RESOLVES } from "./gambits.js";
import { SYSTEM_ID } from "./core.js";

/* -------------------------------------------- */
/*  State helpers                               */
/* -------------------------------------------- */

/** Escape text before it goes into markup. Actor and item names are authored
 *  by users, so they cannot be trusted as HTML. */
function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

/** Is the Storyteller's Guide combat overhaul switched on for this world? */
function usingReforged() {
  try {
    return !!game.settings.get(SYSTEM_ID, "combatReforged");
  } catch (err) {
    return false;
  }
}

function inBreak(actor) {
  return !!actor?.effects?.some((e) => e.statuses?.has?.("break"));
}

function isBattleGroup(actor) {
  return actor?.type === "npc" && actor?.system?.battlegroup === true;
}

function currentTarget() {
  return Array.from(game.user?.targets ?? [])[0]?.actor ?? null;
}

/** Equipped weapons, which are what weaponAttack() needs a uuid for. */
function equippedWeapons(actor) {
  return actor.items.filter((i) => i.type === "weapon" && i.system?.equipped);
}

/**
 * Which attacks may be used against this target, and why not.
 * Under Combat Reforged the target's state decides the attack outright; under
 * standard rules both are legal and the Power/Hardness gate is the players'.
 */
function legality(target, reforged) {
  const allow = { withering: true, decisive: true, gambit: true };
  const why = {};

  if (!target) return { allow, why, state: "none" };

  if (isBattleGroup(target)) {
    allow.withering = false;
    why.withering = "Battle groups can't be withered, except inside a grapple.";
    return { allow, why, state: "group" };
  }

  if (!reforged) return { allow, why, state: "standard" };

  if (inBreak(target)) {
    allow.withering = false;
    why.withering = "They are in Break — only decisive attacks can land.";
    return { allow, why, state: "break" };
  }

  const poise = target.system?.poise?.value ?? 0;
  allow.decisive = false;
  allow.gambit = false;
  why.decisive = `They still have ${poise} Poise. Wither them into Break first.`;
  // Not quite the same reason as decisive: Hero's Trick is the one way a
  // gambit reaches a target who is still standing.
  why.gambit = `${why.decisive} With Hero's Trick, wither them and spend the `
    + "Power that attack earns on a gambit at Step 5 — but then it cannot "
    + "Break them or cost them Poise.";
  return { allow, why, state: "standing" };
}

/**
 * The numbers a roll will actually use against this target.
 *
 * The system's roller adjusts a target's Defense and Poise for the conditions
 * on their token, so reading the raw sheet values would advise you with
 * numbers the roll then contradicts. This mirrors that adjustment.
 *
 * Source: module/apps/dice-roller.js, the block that inspects target effects
 * (prone, surprised, cover, concealment, grappling) plus the wound penalty.
 * If the system changes those, this drifts out of step - which is why the
 * panel shows its working rather than only the total.
 *
 * Two things are reported rather than folded in: cover only applies against
 * ranged attacks, and concealment costs the attacker dice rather than raising
 * Defense. The panel cannot know which weapon you will reach for.
 */
function targetNumbers(target, reforged) {
  const has = (name) => !!target?.effects?.some((e) => e.name === name);
  // The roller picks the target's Defense by actor type: an NPC has a single
  // Defense, while a character defends with the better of Parry and Evasion.
  // Reading Defense first and falling back only when it is missing looks
  // equivalent and is not: every actor has a Defense field, defaulting to
  // zero, so the fallback never fired and characters all showed Defense 0.
  const baseDefense =
    target?.type === "npc"
      ? target?.system?.defense?.value ?? 0
      : Math.max(target?.system?.parry?.value ?? 0,
                 target?.system?.evasion?.value ?? 0);
  const basePoise = target?.system?.poise?.value ?? 0;

  let defense = baseDefense;
  let poise = basePoise;
  const working = [];

  if (has("prone")) {
    defense -= 2;
    working.push("prone &minus;2");
  }
  if (has("surprised")) {
    defense -= 1;
    poise -= 1;
    working.push("surprised &minus;1 Defense and Poise");
  }
  if (reforged && has("grappling")) {
    defense -= 1;
    working.push("grappled &minus;1");
  }

  // Incapacitated reports as "inc" rather than a number; the roller counts it
  // as 2.
  const penalty = target?.system?.health?.penalty;
  const wound = penalty === "inc" ? 2 : Number(penalty) || 0;
  if (wound) {
    defense -= wound;
    working.push(`wounds &minus;${wound}`);
  }

  const notes = [];
  if (has("heavycover")) notes.push("heavy cover +2 Defense against ranged attacks");
  else if (has("lightcover")) notes.push("light cover +1 Defense against ranged attacks");
  if (has("concealment")) notes.push("concealment &minus;2 dice from your pool");

  return {
    baseDefense,
    basePoise,
    defense: Math.max(0, defense),
    poise: Math.max(0, poise),
    soak: target?.system?.soak?.value ?? 0,
    working,
    notes
  };
}

/**
 * What a social influence roll has to beat.
 *
 * Deliberately not part of targetNumbers(). That function mirrors the
 * condition modifiers the roller applies to Defense - prone, surprised,
 * grappled, wounds - and the roller applies none of them to Resolve. Sharing
 * the two would imply a prone target is easier to talk round, which is the
 * confusion this block exists to prevent.
 *
 * The Intimacy and Virtue adjustment is not predicted here. The roller asks
 * for it when the roll is declared and applies it itself, and which
 * Intimacies apply is a table judgement, so guessing would produce a target
 * number that is confidently wrong.
 */
function socialNumbers(target) {
  const resolve = target?.system?.resolve?.value ?? 0;
  return { resolve, floor: 1 };
}

/**
 * The gambits, and what the roller will charge for each.
 *
 * The system owns gambits already - CONFIG.EXALTEDESSENCE.gambits fills a
 * dropdown, and the roller sets powerSpent from a cost table of its own. This
 * mirrors that table rather than inventing one, because the panel opens the
 * roller with the gambit already selected, and the roller only recomputes the
 * cost when the selection *changes*. A pre-selected gambit therefore keeps the
 * number set here, so a number that disagrees with the system would be spent.
 * tools/check-roller.py watches the system's table for exactly that reason.
 *
 * `cost` is a number, or a name resolved against the target:
 *   "defense"  the target's Defense, as the system does for Disarm.
 *   "grapple"  Combat Reforged only, and the system has no cost for it.
 */
const GAMBITS = [
  { key: "disarm", name: "Disarm", cost: "defense",
    effect: "Knocks their weapon away and leaves them open." },
  { key: "distract", name: "Distract", cost: 2,
    effect: "Drops their Defense. May be rolled with Performance or Presence, "
      + "and may go against Resolve instead of Defense." },
  { key: "ensnare", name: "Ensnare", cost: 3, discount: "flexible",
    effect: "Stops them moving. They can break free with Athletics or Close "
      + "Combat." },
  { key: "knockback", name: "Knockback", cost: 4, discount: "smashing",
    effect: "Drives them one range band away and drops their Defense.",
    reforged: "They cannot Rush you for a turn, and it may be rolled with "
      + "Physique." },
  { key: "knockdown", name: "Knockdown", cost: 4, discount: "smashing",
    effect: "Puts them prone.",
    reforged: "May be rolled with Physique." },
  { key: "pilfer", name: "Pilfer", cost: 3,
    effect: "Lifts one non-weapon item. Rolled with Stealth." },
  { key: "pull", name: "Pull", cost: 4, tag: "pull",
    effect: "Drags them one range band toward you." },
  { key: "reveal_weakness", name: "Reveal Weakness", cost: 3,
    effect: "Cuts their Soak, for everyone. May be rolled with Craft or War." },
  { key: "unhorse", name: "Unhorse", cost: 5,
    effect: "Unseats them from their mount." },
  { key: "grapple", name: "Grapple", cost: "grapple", reforgedOnly: true,
    effect: "Both of you take &minus;1 Defense, and neither can move until "
      + "someone escapes." }
];

/**
 * What Grapple costs under Combat Reforged: the higher of the target's
 * Physique or Athletics, or half an antagonist's relevant pool.
 *
 * Which pool is "relevant" is the Storyteller's call, so the primary pool is
 * used and the working is shown rather than presented as settled.
 */
function grappleCost(target) {
  if (!target) return null;
  if (target.type === "npc") {
    const pool = target.system?.pools?.primary?.value ?? 0;
    return { power: Math.ceil(pool / 2),
             working: `half their primary pool (${pool})`,
             soft: true };
  }
  const physique = target.system?.abilities?.physique?.value ?? 0;
  const athletics = target.system?.abilities?.athletics?.value ?? 0;
  const best = Math.max(physique, athletics);
  return { power: best,
           working: physique >= athletics
             ? `their Physique ${physique}`
             : `their Athletics ${athletics}` };
}

/**
 * One gambit, priced for this weapon and target: what it costs, whether it can
 * be used at all, and why not when it cannot.
 */
function priceGambit(gambit, weapon, target, defense, reforged) {
  const tags = weapon?.system?.traits?.weapontags?.selected ?? {};
  const row = { key: gambit.key, name: gambit.name, effect: gambit.effect };

  if (gambit.reforgedOnly && !reforged) {
    row.blocked = "Grappling is only a gambit under Combat Reforged.";
    return row;
  }
  if (gambit.tag && !tags[gambit.tag]) {
    row.blocked = `Needs a weapon with the ${gambit.tag} tag.`;
    return row;
  }

  if (gambit.cost === "grapple") {
    const grapple = grappleCost(target);
    if (!grapple) {
      row.blocked = "Costs the target's Physique or Athletics - pick a target.";
      return row;
    }
    row.power = grapple.power;
    row.working = grapple.working;
    // The system lists Grapple in its dropdown but has no cost for it, so the
    // roller would open with nothing wagered. Say so rather than let a player
    // discover it mid-roll.
    row.note = grapple.soft
      ? "The Storyteller may price this off a different pool."
      : "";
    row.unpriced = true;
    row.panelApplies = true;
    return row;
  }

  if (gambit.cost === "defense") {
    if (!target) {
      row.blocked = "Costs the target's Defense - pick a target.";
      return row;
    }
    row.power = defense;
    row.working = "their Defense";
    return row;
  }

  row.power = gambit.cost;
  if (gambit.discount && tags[gambit.discount]) {
    row.power -= 1;
    row.working = `${gambit.cost} &minus; 1 for ${gambit.discount}`;
  }
  if (reforged && gambit.reforged) row.note = gambit.reforged;
  if (PANEL_RESOLVES.includes(gambit.key)) row.panelApplies = true;
  return row;
}

export {
  GAMBITS,
  currentTarget,
  equippedWeapons,
  esc,
  grappleCost,
  inBreak,
  isBattleGroup,
  legality,
  priceGambit,
  socialNumbers,
  targetNumbers,
  usingReforged
};
