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

const MODULE_ID = "essence-poise-break";
const SYSTEM_ID = "exaltedessence";

/**
 * The system version whose condition modifiers targetNumbers() was checked
 * against. A different version is not a problem in itself - it is only the
 * context you want if a number ever disagrees with a roll.
 */
const VERIFIED_SYSTEM = "3.1.0";

/** Only nag once per session; the console keeps the full record. */
let driftWarned = false;

const { ApplicationV2 } = foundry.applications.api;

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

/* -------------------------------------------- */
/*  Finishing the gambits the system leaves open */
/* -------------------------------------------- */

/**
 * Which gambits the system resolves, and which it does not.
 *
 * `_resolveGambit()` in the system's dice-roller handles six of the ten:
 * Disarm, Knockdown and Ensnare set a status; Reveal Weakness cuts Soak; Pull
 * and Distract apply a Defense penalty. Knockback and Grapple fall through the
 * switch and do nothing at all - even though the book gives both a Defense
 * penalty. Pilfer and Unhorse are left out on purpose: taking an item and
 * choosing between prone and Soak are table decisions, not automatable ones.
 */
const SYSTEM_RESOLVES = ["disarm", "knockdown", "ensnare", "reveal_weakness",
                         "pull", "distract"];
const PANEL_RESOLVES = ["knockback", "grapple"];

/** A -1 Defense change, written the way the system writes it for this type. */
function defenceChanges(actor, value) {
  return actor?.type === "npc"
    ? [{ key: "system.defense.value", value: -value, mode: 2 }]
    : [{ key: "system.evasion.value", value: -value, mode: 2 },
       { key: "system.parry.value", value: -value, mode: 2 }];
}

/**
 * The grapple effect: the status and its penalty in one document.
 *
 * Kept as a single effect on purpose. The system's own grapple penalty reads
 * `e.name === 'grappling'`, but Foundry localises a status effect's name when
 * it creates it, so the effect is called "Grappling" and that check never
 * matches - which is why grappling costs nobody any Defense today. Carrying
 * the change on the status itself means the penalty is applied, and that
 * clearing the status clears the penalty with it rather than leaving a
 * stray -1 behind.
 */
function grappleEffect(actor) {
  return {
    name: "Grappling",
    img: "systems/exaltedessence/assets/icons/shaking-hands.svg",
    statuses: ["grappling"],
    origin: actor?.uuid,
    disabled: false,
    flags: {
      "essence-poise-break": { grapple: true },
      exaltedessence: { statusId: "grappling" }
    },
    changes: defenceChanges(actor, 1)
  };
}

function alreadyGrappling(effects) {
  return (effects ?? []).some((effect) => {
    const statuses = effect?.statuses;
    const has = statuses?.has ? statuses.has("grappling")
      : Array.isArray(statuses) && statuses.includes("grappling");
    return has || effect?.flags?.["essence-poise-break"]?.grapple;
  });
}

/**
 * Fill in what the system's gambit resolution misses, on this roll only.
 *
 * Wrapping the form's own `_resolveGambit` rather than applying effects here
 * matters: everything pushed into `newTargetData.effects` and `addStatuses` is
 * applied afterwards by the system's `_updateTargetActor()`, which already
 * knows to relay through a socket when the roller is not a GM. Writing to the
 * target directly from here would work for a Storyteller and fail silently for
 * everyone else.
 *
 * Each addition checks first whether it is already there, so if the system
 * grows a case of its own the panel stops adding a second one.
 */
function resolveMissingGambits(form) {
  const original = form?._resolveGambit;
  if (typeof original !== "function") {
    console.warn(`${MODULE_ID} | the system's _resolveGambit is missing, so `
      + "Knockback and Grapple will apply nothing. Check the panel against "
      + `${SYSTEM_ID} ${game.system.version}.`);
    return;
  }

  form._resolveGambit = function (postDefenseTotal = 0) {
    original.call(this, postDefenseTotal);
    try {
      const object = this.object;
      const target = object?.target?.actor;

      if (object?.gambit === "knockback" && postDefenseTotal > 0) {
        // The same treatment the system gives Pull, which the book prices
        // identically: 1 Defense per extra success, until the round ends.
        // Only when there are extra successes - Pull applies a (0) penalty
        // with none, and one pointless effect on a token is enough.
        const already = object.newTargetData?.effects?.some(
          (e) => e?.flags?.exaltedessence?.statusId === "end_of_round");
        if (!already) this._addEndofRoundDefensePenalty(postDefenseTotal);
      }

      if (object?.gambit === "grapple") {
        object.updateTargetActorData = true;
        if (!alreadyGrappling(object.newTargetData?.effects)) {
          object.newTargetData.effects.push(grappleEffect(target));
        }
        // Both sides of a grapple take the penalty, and the roller only ever
        // updates the target, so the attacker is the panel's to handle. Not
        // awaited: this runs inside the roll, and the attacker's effect has to
        // wait for the roll's own writes to land first.
        grappleTheAttacker(this.actor);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | could not finish the gambit`, err);
    }
  };
}

/**
 * Wait until the roller has finished writing to this actor.
 *
 * A gambit roll spends Power with `this.actor.update(actorData)`, where
 * actorData is a duplicate of the whole actor taken before the roll - and the
 * call is not awaited. Foundry rebuilds an embedded collection from exactly
 * the array it is handed, so an effect created between the snapshot and that
 * write is simply not in the array, and is dropped when it lands.
 *
 * Resolves on the actor's next update, or after a moment if none arrives -
 * the Power spend is normally that update, but a gambit costing 0 Power
 * changes nothing and so fires no hook.
 */
function afterActorSettles(actor, timeout = 1200) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      Hooks.off("updateActor", onUpdate);
      resolve();
    };
    const onUpdate = (document) => {
      // A tick later, so the write is committed rather than merely announced.
      if (document?.id === actor?.id) setTimeout(finish, 0);
    };
    Hooks.on("updateActor", onUpdate);
    setTimeout(finish, timeout);
  });
}

/**
 * The grappler's own -1, on the actor the panel already owns.
 *
 * Deliberately not created during _resolveGambit: see afterActorSettles(). The
 * result is checked rather than assumed, because the failure mode this works
 * around is silent - the effect is created successfully and then removed.
 */
async function grappleTheAttacker(actor) {
  try {
    if (!actor || alreadyGrappling(actor.effects)) return;
    await afterActorSettles(actor);
    if (alreadyGrappling(actor.effects)) return;
    await actor.createEmbeddedDocuments("ActiveEffect", [grappleEffect(actor)]);

    // Confirm it survived. If the roller wrote again afterwards it will have
    // taken the effect with it, and saying so beats a penalty that quietly
    // is not there.
    setTimeout(() => {
      if (!alreadyGrappling(actor.effects)) {
        console.warn(`${MODULE_ID} | the grappling effect on ${actor.name} was `
          + "removed again after it was created - the roller wrote over it.");
        // Plain text: a notification is not rendered as markup.
        ui.notifications.warn(`Poise & Break: could not keep ${actor.name} in `
          + "the grapple. Apply their −1 Defense by hand.");
      }
    }, 1500);
  } catch (err) {
    console.error(`${MODULE_ID} | could not grapple the attacker`, err);
    ui.notifications.warn(`Poise & Break: could not apply ${actor?.name}'s own `
      + "grapple penalty - see the console.");
  }
}

/* -------------------------------------------- */
/*  Clearing gambit effects once they are over  */
/* -------------------------------------------- */

/**
 * The timed effects a gambit leaves behind.
 *
 * `end_of_round` is the Defense penalty from Distract and Pull, and from the
 * panel's Knockback: the book gives all three "for the rest of the round".
 * `reveal_weakness` cuts Soak for rounds equal to the extra successes.
 *
 * Nothing in the system removes either. Foundry 14 can expire an effect, but
 * by default it only marks it expired - it stays on the token, and every
 * gambit adds another.
 *
 * And Foundry counts their rounds wrongly. The roller creates them inside a
 * bulk actor update, which skips the step where Foundry records when an effect
 * started. With no start round, Foundry counts from the round the target
 * joined combat, so a one-round penalty applied in round 3 is already overdue
 * when it lands - and can be switched off at the target's next turn, while the
 * rest of the round it was meant to last is still going.
 */
const TIMED_GAMBIT_EFFECTS = ["end_of_round", "reveal_weakness"];

function timedGambitEffect(effect) {
  const id = effect?.flags?.exaltedessence?.statusId;
  return TIMED_GAMBIT_EFFECTS.includes(id) ? id : null;
}

/**
 * Whether this client is the one that should write. Every client sees the same
 * hooks, and without this each GM and player would try the same deletion.
 */
function isResponsibleGM() {
  const gm = game.users?.activeGM;
  return gm ? !!gm.isSelf : !!game.user?.isGM;
}

function clearingGambitEffects() {
  try {
    return !!game.settings.get(MODULE_ID, "clearGambitEffects");
  } catch (err) {
    return false;
  }
}

/**
 * Is this gambit effect finished once the combat reaches `round`?
 *
 * A rest-of-the-round penalty is over at the next round. Reveal Weakness lasts
 * its own number of rounds, and never less than the rest of this one. An effect
 * with no record of when it began is read as rest-of-the-round: the cautious
 * reading, and the one that clears leftovers from before this existed.
 */
function gambitEffectOver(effect, round) {
  if (!timedGambitEffect(effect)) return false;
  if (effect.duration?.expired) return true;
  const began = effect.start?.round;
  if (!Number.isFinite(began)) return true;
  const value = Number(effect.duration?.value);
  const lasts = Math.max(1, Number.isFinite(value) ? value : 1);
  return round - began >= lasts;
}

/**
 * Record when a gambit effect began - the step the roller's bulk update skips.
 *
 * This is Foundry's own start data, filled in as it would have been had the
 * effect been created normally, so Foundry's duration display and expiry stop
 * counting from the wrong round too, not just this module's clean-up.
 */
async function stampGambitEffect(effect) {
  if (!timedGambitEffect(effect) || effect.start) return;
  if (!clearingGambitEffects() || !isResponsibleGM()) return;

  const combat = game.combat;
  const running = !!combat?.started;
  const documentClass = CONFIG.ActiveEffect?.documentClass;
  const start = typeof documentClass?.getEffectStart === "function"
    ? documentClass.getEffectStart(combat)
    : {
        time: game.time?.worldTime ?? 0,
        combat: running ? combat.id : null,
        combatant: running ? combat.combatant?.id ?? null : null,
        initiative: running ? combat.combatant?.initiative ?? null : null,
        round: running ? combat.round : null,
        turn: running ? combat.turn : null
      };

  try {
    await effect.update({ start });
  } catch (err) {
    console.error(`${MODULE_ID} | could not record when ${effect.name} began`, err);
  }
}

/**
 * Delete the gambit effects whose time is up, for everyone in a combat.
 *
 * `ended` clears every one of them regardless of rounds left: an effect that
 * lasts a round or three has no business outliving the fight it came from.
 */
async function sweepGambitEffects(combat, { ended = false } = {}) {
  if (!combat || !clearingGambitEffects() || !isResponsibleGM()) return;

  const round = combat.round ?? 0;
  const seen = new Set();
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant?.actor;
    // An actor can sit on more than one combatant.
    if (!actor || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);

    const ids = [];
    for (const effect of actor.effects ?? []) {
      if (!timedGambitEffect(effect)) continue;
      if (ended || gambitEffectOver(effect, round)) ids.push(effect.id);
    }
    if (!ids.length) continue;

    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    } catch (err) {
      console.error(`${MODULE_ID} | could not clear finished gambit effects `
        + `on ${actor.name}`, err);
    }
  }
}

/**
 * A round change that moves forward - not a rewind, and not a turn change.
 *
 * Read from Combat#previous, which Foundry records before the updateCombat
 * hook fires. The system's own nextRound() does not call super, so the
 * combatRound hook Foundry would normally fire never does.
 */
function roundAdvanced(combat, changed) {
  if (!changed || !("round" in changed)) return false;
  return (changed.round ?? 0) > (combat?.previous?.round ?? 0);
}

/* -------------------------------------------- */
/*  Poise as shards, and the Break effect       */
/* -------------------------------------------- */

/** Past this many, shards stop reading as a count; the number carries it. */
const MAX_SHARDS = 10;

/**
 * Poise as a row of jade shards: full for the Poise left, faint for what has
 * been worn away, and every one of them cracked in Break. The number is always
 * printed beside it as well - the shards are for a glance, not for counting.
 */
function poiseShards(value, max, { broken = false, small = false } = {}) {
  const current = Math.max(0, Number(value) || 0);
  const top = Math.max(Number(max) || 0, current);
  const drawn = Math.min(MAX_SHARDS, top);
  if (!drawn) return "";

  const filled = broken ? 0 : Math.min(drawn, current);
  const shards = Array.from({ length: drawn }, (_, i) =>
    `<span class="epb-shard${i < filled ? " is-full" : ""}" style="--epb-i:${i}"></span>`
  ).join("");
  const label = broken ? `In Break, Poise 0 of ${top}` : `Poise ${current} of ${top}`;
  const classes = ["epb-poise", broken && "is-broken", small && "is-small"]
    .filter(Boolean).join(" ");
  return `<span class="${classes}" role="img" aria-label="${label}">${shards}</span>`;
}

/** Foundry's photosensitive mode, which every animation here follows. */
function photosensitive() {
  try {
    return !!game.settings.get("core", "photosensitiveMode");
  } catch (err) {
    return false;
  }
}

/**
 * The Break effect: the moment a token Breaks, its Poise shatters off it.
 *
 * Purely visual, and local to each client - nothing is written to any
 * document. Every client sees the Break status arrive through
 * createActiveEffect and draws its own copy, so it plays however Break was
 * applied, not only for rolls made from this panel.
 */
const BREAK_COLORS = { jade: 0x63C7A0, break: 0xEE7163 };
const BREAK_SHARDS = 14;
const BREAK_DURATION = 950;

function isBreakEffect(effect) {
  const statuses = effect?.statuses;
  return !!(statuses?.has ? statuses.has("break")
    : Array.isArray(statuses) && statuses.includes("break"));
}

function showingBreakEffect() {
  try {
    return !!game.settings.get(MODULE_ID, "breakEffect");
  } catch (err) {
    return false;
  }
}

/**
 * The tokens that should shatter for this effect, on this client.
 *
 * Token#isVisible is the gate that matters. It is false for a token hidden
 * from players and for one outside this player's vision, and a shatter drawn
 * there would give away where it is.
 */
function breakEffectTokens(effect) {
  if (!isBreakEffect(effect) || !showingBreakEffect()) return [];
  const actor = effect.parent;
  if (typeof actor?.getActiveTokens !== "function") return [];
  return actor.getActiveTokens().filter((token) => token?.isVisible && !token.destroyed);
}

/** A stable number from a token id, so a token shatters the same way each time. */
function seedFor(id) {
  let hash = 2166136261;
  for (const char of String(id ?? "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A small seedable generator; plenty random for scattering shards. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where the shards sit around a token, in fractions of its radius. Spread
 * evenly with a little jitter, so it reads as one crystal coming apart rather
 * than confetti.
 */
function shardLayout(count, seed) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    angle: (i / count) * Math.PI * 2 + (random() - 0.5) * 0.35,
    length: 0.24 + random() * 0.16,
    width: 0.10 + random() * 0.06,
    spin: (random() - 0.5) * 2.4,
    drift: 0.55 + random() * 0.6
  }));
}

/** The shatter at progress t, from 0 to 1. */
function shatterFrame(t) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  const burst = 1 - (1 - p) ** 3;
  return {
    burst,
    // Whole for a beat, then gone.
    alpha: p < 0.55 ? 1 : Math.max(0, (1 - p) / 0.45),
    // Jade turns red early, so the colour change is the first thing you see.
    tint: Math.min(1, p / 0.35),
    ringScale: 1 + 0.6 * burst,
    // The ring arrives with the crack rather than before it: nothing on the
    // first frame, strongest a fifth of the way in, gone by the end.
    ringAlpha: 0.85 * (p < 0.2 ? p / 0.2 : (1 - p) / 0.8)
  };
}

/** The light a shard passes through as it cracks. */
const CRACK_LIGHT = 0xFFF4E6;

/**
 * A shard's colour as it cracks: jade, to a flash of light, to break red. A
 * straight blend from jade to red passes through a dull grey-brown halfway,
 * which reads as the effect going muddy rather than breaking.
 */
function shardColor(tint, from, to) {
  return tint < 0.5
    ? mixColor(from, CRACK_LIGHT, tint * 2)
    : mixColor(CRACK_LIGHT, to, (tint - 0.5) * 2);
}

/** Blend two 0xRRGGBB colours, channel by channel. */
function mixColor(from, to, amount) {
  const a = Math.min(1, Math.max(0, amount));
  const channel = (shift) => {
    const x = (from >> shift) & 0xff;
    const y = (to >> shift) & 0xff;
    return Math.round(x + (y - x) * a);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * One frame of the shatter, drawn into a PIXI.Graphics with the PIXI 7 API
 * that Foundry 14 bundles. Kept apart from the canvas so the geometry can be
 * tested, and previewed, on its own.
 */
function drawShatter(graphics, layout, frame, radius, from, to) {
  graphics.clear();
  if (frame.ringAlpha > 0) {
    graphics.lineStyle(1 + radius * 0.06 * (1 - frame.burst), to, frame.ringAlpha);
    graphics.drawCircle(0, 0, radius * frame.ringScale);
    graphics.lineStyle(0);
  }
  const color = shardColor(frame.tint, from, to);
  for (const shard of layout) {
    const distance = radius * (0.95 + shard.drift * frame.burst);
    const cx = Math.cos(shard.angle) * distance;
    const cy = Math.sin(shard.angle) * distance;
    const turn = shard.angle + shard.spin * frame.burst;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const long = radius * shard.length;
    const wide = radius * shard.width;
    const points = [[long, 0], [0, wide / 2], [-long * 0.35, 0], [0, -wide / 2]]
      .flatMap(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
    graphics.beginFill(color, frame.alpha);
    graphics.drawPolygon(points);
    graphics.endFill();
  }
}

/**
 * The word BREAK, over the shards.
 *
 * It slams down from nearly twice its size, cracks in two along the same kind
 * of jagged line that splits a panel shard, cools from white-hot to break red,
 * then rises and fades - lingering longer than the shards, long enough to read.
 */
const BREAK_TEXT_DURATION = 1700;
const BREAK_TEXT_DURATION_GENTLE = 2200;
const BREAK_TEXT_IMPACT = 0.14;

/** The word at progress t, from 0 to 1. */
function breakTextFrame(t, { gentle = false } = {}) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  if (gentle) {
    // Photosensitive mode: no slam, no shudder, no flash. It fades in already
    // red, holds, and fades out.
    return {
      alpha: p < 0.2 ? p / 0.2 : p > 0.7 ? Math.max(0, (1 - p) / 0.3) : 1,
      scale: 1,
      shake: 0,
      split: 0,
      tint: 1,
      rise: p > 0.7 ? (0.5 * (p - 0.7)) / (1 - 0.7) : 0
    };
  }
  const landing = Math.min(1, p / BREAK_TEXT_IMPACT);
  const since = Math.max(0, p - BREAK_TEXT_IMPACT);
  const settle = Math.min(1, since / 0.16);
  return {
    alpha: p < 0.06 ? p / 0.06 : p > 0.62 ? Math.max(0, (1 - p) / 0.38) : 1,
    scale: p < BREAK_TEXT_IMPACT ? 1.9 - 0.9 * (1 - (1 - landing) ** 3) : 1,
    // A short shudder from the moment it lands, dying away.
    shake: since > 0 && since < 0.2 ? Math.sin(since * 140) * (1 - since / 0.2) : 0,
    split: 1 - (1 - settle) ** 3,
    tint: Math.min(1, since / 0.18),
    // Divided by (1 - 0.55), not 0.45: in floating point that reaches exactly
    // 1 at the end, where 0.45 lands a hair short.
    rise: p > 0.55 ? (p - 0.55) / (1 - 0.55) : 0
  };
}

/** The word's size, in pixels at scene scale. */
const BREAK_TEXT_SIZE_MIN = 48;
const BREAK_TEXT_SIZE_MAX = 120;

/**
 * Big enough to land as the biggest thing on the map for a moment - and bigger
 * than a Charm callout, since a Break is the bigger event. It first shipped at
 * about two thirds of the token's radius, which the table found too small, so
 * it is now a little over the radius, and still bounded over a huge token.
 */
function breakTextSize(radius) {
  return Math.round(Math.min(BREAK_TEXT_SIZE_MAX,
    Math.max(BREAK_TEXT_SIZE_MIN, (Number(radius) || 0) * 1.2)));
}

/**
 * The mask for one half of the word: from a jagged crack a little off centre,
 * out past the word's edge. Both halves share the crack, so at rest they meet
 * exactly and the word reads whole.
 */
function crackMask(side, width, height) {
  const crack = [[0.07, -0.75], [-0.03, -0.12], [0.05, 0.14], [-0.06, 0.75]]
    .map(([x, y]) => [x * width, y * height]);
  const edge = side * width;
  return [...crack, [edge, 0.75 * height], [edge, -0.75 * height]].flat();
}

function breakTextStyle(pixi, size) {
  const options = {
    fontFamily: "Modesto Condensed",
    fontSize: size,
    fill: 0xFFFFFF,
    stroke: 0x160A08,
    strokeThickness: Math.max(3, Math.round(size * 0.1)),
    letterSpacing: Math.round(size * 0.06),
    align: "center",
    dropShadow: true,
    dropShadowColor: 0x000000,
    dropShadowAlpha: 0.85,
    dropShadowBlur: Math.round(size * 0.25),
    dropShadowDistance: 0,
    dropShadowAngle: 0
  };
  const Precise = foundry.canvas?.containers?.PreciseText;
  return typeof Precise?.getTextStyle === "function"
    ? Precise.getTextStyle(options)
    : new pixi.TextStyle(options);
}

/**
 * Build the word as two copies, each masked to one side of the crack so the
 * halves can come apart. Foundry's PreciseText keeps it sharp at any zoom;
 * plain PIXI text stands in outside Foundry. Returns the container and a
 * function that draws the word at progress t.
 */
function createBreakText(pixi, radius, { gentle = false } = {}) {
  const size = breakTextSize(radius);
  const style = breakTextStyle(pixi, size);
  const TextClass = foundry.canvas?.containers?.PreciseText ?? pixi.Text;

  const root = new pixi.Container();
  root.eventMode = "none";
  const halves = [-1, 1].map((side) => {
    const piece = root.addChild(new pixi.Container());
    const text = piece.addChild(new TextClass("BREAK", style));
    text.anchor.set(0.5, 0.5);
    const mask = piece.addChild(new pixi.Graphics());
    mask.beginFill(0xFFFFFF);
    mask.drawPolygon(crackMask(side, text.width, text.height));
    mask.endFill();
    text.mask = mask;
    return { piece, text, side };
  });

  const update = (t) => {
    const frame = breakTextFrame(t, { gentle });
    root.alpha = frame.alpha;
    root.scale.set(frame.scale);
    root.position.set(frame.shake * size * 0.06, -radius * (0.15 + 0.5 * frame.rise));
    const color = mixColor(CRACK_LIGHT, BREAK_COLORS.break, frame.tint);
    for (const { piece, text, side } of halves) {
      text.tint = color;
      piece.position.set(side * frame.split * size * 0.05, side * frame.split * size * 0.03);
      piece.rotation = side * frame.split * 0.035;
    }
  };
  update(0);
  return { container: root, update, size };
}

/**
 * Foundry floats a small "+(Break)" as the status lands. With the BREAK text
 * playing, that says the same thing twice in the same place, so on a client
 * showing the effect it is skipped - for Break alone, and only as it lands.
 * Every other status, and "-(Break)" as Break ends, is drawn exactly as
 * Foundry draws it. A player with the effect switched off keeps Foundry's.
 */
function quietCoreBreakText() {
  const documentClass = CONFIG.ActiveEffect?.documentClass;
  const original = documentClass?.prototype?._displayScrollingStatus;
  if (typeof original !== "function" || original.epbQuietsBreak) return false;
  const wrapped = function (enabled) {
    if (enabled && isBreakEffect(this) && showingBreakEffect()) return undefined;
    return original.call(this, enabled);
  };
  wrapped.epbQuietsBreak = true;
  documentClass.prototype._displayScrollingStatus = wrapped;
  return true;
}

/**
 * Play the shatter on one token. The drawing lives in the interface canvas
 * group, above the tokens, and is destroyed when the animation ends - or found
 * already destroyed, if the canvas was torn down around it.
 */
async function playBreakEffect(token) {
  const pixi = globalThis.PIXI;
  const board = globalThis.canvas;
  const CanvasAnimation = foundry.canvas?.animation?.CanvasAnimation;
  if (!pixi || !board?.interface || !CanvasAnimation || !token?.center) return;

  const radius = Math.max(token.w ?? 0, token.h ?? 0) / 2;
  if (!radius) return;
  const gentle = board.photosensitiveMode === true || photosensitive();

  // A token with a dynamic ring flashes it red as well. Foundry softens that
  // flash itself in photosensitive mode.
  if (token.hasDynamicRing && token.ring?.flashColor && foundry.utils?.Color) {
    token.ring.flashColor(foundry.utils.Color.from(BREAK_COLORS.break), { duration: 1600 })
      ?.catch?.(() => {});
  }

  const container = new pixi.Container();
  container.eventMode = "none";
  container.position.set(token.center.x, token.center.y);
  const graphics = container.addChild(new pixi.Graphics());
  // The word sits on top of the shards. If it cannot be built for any reason,
  // the shatter still plays without it.
  let label = null;
  try {
    label = createBreakText(pixi, radius, { gentle });
    container.addChild(label.container);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not draw the BREAK text`, err);
  }
  // Above the token layer. The interface group sorts its children by zIndex,
  // and each token draws a void mesh that erases interface content beneath it
  // inside the token's outline. At the default of 0 that hid the word entirely
  // and cut the shards off at the token's edge. Foundry's own floating text sits
  // at this level for the same reason.
  container.zIndex = CONFIG.Canvas?.groups?.interface?.zIndexScrollingText ?? 1100;
  board.interface.addChild(container);

  // Photosensitive mode gets the ring alone, slower and fainter: no burst of
  // shards across the screen.
  const layout = gentle ? [] : shardLayout(BREAK_SHARDS, seedFor(token.id));
  const state = { t: 0 };
  const draw = () => {
    if (graphics.destroyed) return;
    const frame = shatterFrame(state.t);
    if (gentle) frame.ringAlpha *= 0.4;
    drawShatter(graphics, layout, frame, radius, BREAK_COLORS.jade, BREAK_COLORS.break);
  };

  const words = { t: 0 };
  const write = () => {
    if (label && !label.container.destroyed) label.update(words.t);
  };

  try {
    draw();
    write();
    await Promise.all([
      CanvasAnimation.animate(
        [{ parent: state, attribute: "t", from: 0, to: 1 }],
        {
          name: `${MODULE_ID}.break.${token.id}`,
          context: container,
          duration: gentle ? 1600 : BREAK_DURATION,
          ontick: draw
        }
      ),
      label ? CanvasAnimation.animate(
        [{ parent: words, attribute: "t", from: 0, to: 1 }],
        {
          name: `${MODULE_ID}.break-text.${token.id}`,
          context: container,
          duration: gentle ? BREAK_TEXT_DURATION_GENTLE : BREAK_TEXT_DURATION,
          ontick: write
        }
      ) : null
    ]);
  } catch (err) {
    console.error(`${MODULE_ID} | could not play the Break effect`, err);
  } finally {
    if (!container.destroyed) container.destroy({ children: true });
  }
}

/* -------------------------------------------- */
/*  The decisive cut-in                         */
/* -------------------------------------------- */

/**
 * The decisive cut-in: when a decisive attack lands, the attacker's portrait
 * slams across every screen in a band of their anima colour, with the Charms
 * they put into the strike.
 *
 * The roll happens on one client, and the Charms added to it live only in that
 * client's roller - nothing about them reaches the chat card. So the roller's
 * own attack-animation step, attackSequence(), is wrapped: it runs first and
 * unchanged, then the rolling client plays the cut-in and sends it to everyone
 * else over the module's socket. Each client decides for itself whether to
 * show it, and nothing is written to any document.
 */
const CUT_IN_SOCKET = `module.${MODULE_ID}`;
const CUT_IN_MESSAGE = "decisiveCutIn";
/** Matched by the animations in styles/cut-in.css. */
const CUT_IN_DURATION = 1600;
const CUT_IN_DURATION_GENTLE = 2200;
/** Charms named on the band; any more are counted. */
const CUT_IN_CHARMS = 3;
/** Orichalcum, the colour this module already gives decisive attacks. */
const CUT_IN_FALLBACK = "#E5B356";
const CUT_IN_PORTRAIT = "icons/svg/mystery-man.svg";

function showingCutIn() {
  try {
    return !!game.settings.get(MODULE_ID, "decisiveCutIn");
  } catch (err) {
    return false;
  }
}

function revealingStorytellerCharms() {
  try {
    return !!game.settings.get(MODULE_ID, "revealStorytellerCharms");
  } catch (err) {
    return false;
  }
}

/**
 * Did this roll land a decisive attack? The roller's own test, at the end of a
 * damage roll: accuracy less Defense below zero misses, and anything else hits
 * - even with no extra successes to spare.
 */
function isDecisiveHit(object) {
  if (object?.rollType !== "decisive") return false;
  const accuracy = Number(object.accuracyResult);
  const defense = Number(object.defense);
  if (!Number.isFinite(accuracy) || !Number.isFinite(defense)) return false;
  return accuracy - defense >= 0;
}

/**
 * The band's colour, from the sheet's anima colour. Only a six-digit hex gets
 * through, since it goes into a style. The system defaults anima to white,
 * which is no colour at all on a band of light, so near-white is orichalcum.
 */
function cutInColor(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (!match) return CUT_IN_FALLBACK;
  const number = parseInt(match[1], 16);
  const channels = [number >> 16, number >> 8, number].map((c) => c & 0xff);
  if (Math.min(...channels) > 225) return CUT_IN_FALLBACK;
  return `#${match[1].toUpperCase()}`;
}

/** A portrait path, or Foundry's silhouette in place of one that could run script. */
function cutInImage(value) {
  const src = typeof value === "string" ? value.trim() : "";
  // Browsers ignore whitespace and control characters inside a URL scheme.
  const scheme = src.replace(/[\s\u0000-\u001f]+/g, "");
  if (!src || /^(?:javascript|vbscript):|^data:(?!image\/)/i.test(scheme)) {
    return CUT_IN_PORTRAIT;
  }
  return src;
}

/**
 * What a cut-in carries, made safe. It arrives over the socket from another
 * client, so every field is untrusted: text is trimmed and capped, the colour
 * and portrait are checked, and anything else is dropped.
 */
function cleanCutInPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const name = text(raw.name, 80);
  if (!name) return null;
  const charms = Array.isArray(raw.charms)
    ? [...new Set(raw.charms.map((charm) => text(charm, 80)).filter(Boolean))].slice(0, 12)
    : [];
  return {
    actorUuid: text(raw.actorUuid, 200) || null,
    tokenId: text(raw.tokenId, 64) || null,
    sceneId: text(raw.sceneId, 64) || null,
    name,
    img: cutInImage(raw.img),
    color: cutInColor(raw.color),
    charms,
    storyteller: raw.storyteller === true
  };
}

/** The cut-in for a roller at the end of its damage roll, or null if it missed. */
function cutInPayload(form) {
  const actor = form?.actor;
  if (!actor || !isDecisiveHit(form.object)) return null;
  let token = null;
  try {
    token = typeof form._getActorToken === "function" ? form._getActorToken() : null;
  } catch (err) {
    token = null;
  }
  // The roller may hand back the token on the canvas or its document.
  const tokenDocument = token?.document ?? token;
  return cleanCutInPayload({
    actorUuid: actor.uuid,
    tokenId: tokenDocument?.id,
    sceneId: tokenDocument?.parent?.id,
    name: actor.name,
    img: actor.img,
    color: animaColorFor(actor),
    charms: (form.object.addedCharms ?? []).map((charm) => charm?.name),
    storyteller: !actor.hasPlayerOwner
  });
}

/** The attacking actor on this client, if it has it. */
function cutInActor(payload) {
  try {
    return payload?.actorUuid ? globalThis.fromUuidSync?.(payload.actorUuid) ?? null : null;
  } catch (err) {
    return null;
  }
}

/**
 * Should this client show the cut-in? On the scene it is looking at, the
 * attacker's token decides: Token#isVisible is false for a token hidden from
 * players and for one outside their vision, and a cut-in would give it away.
 * Anywhere else, only the attacker's owners and the Storyteller see it.
 */
function shouldShowCutIn(payload, user = game.user) {
  if (!payload || !showingCutIn()) return false;
  const board = globalThis.canvas;
  if (payload.tokenId && board?.scene?.id && board.scene.id === payload.sceneId) {
    const token = board.tokens?.get?.(payload.tokenId);
    if (token) return !!token.isVisible && !token.destroyed;
  }
  if (user?.isGM) return true;
  return !!cutInActor(payload)?.isOwner;
}

/**
 * The Charms this user is shown. A player's are named for everyone. An
 * antagonist's stay with the Storyteller unless the table chooses to name
 * them, since players may not know what it can do. Who owns the attacker is
 * read from the actor where this client has it, not taken from the message.
 */
function cutInCharms(payload, user = game.user, actor = null) {
  if (!payload?.charms?.length) return [];
  const storyteller = actor ? !actor.hasPlayerOwner : payload.storyteller;
  if (storyteller && !user?.isGM && !revealingStorytellerCharms()) return [];
  return payload.charms;
}

/** The cut-in's markup. Every name in it is escaped. */
function cutInMarkup(payload, { charms = [], gentle = false } = {}) {
  const shown = charms.slice(0, CUT_IN_CHARMS);
  const more = charms.length - shown.length;
  const list = shown.length
    ? `<ul class="epb-cutin-charms">${shown.map((charm) => `<li>${esc(charm)}</li>`).join("")}${
      more > 0 ? `<li class="epb-cutin-more">+${more} more</li>` : ""}</ul>`
    : "";
  return `<div class="epb-cutin" style="--epb-cutin-color: ${cutInColor(payload?.color)}"${
    gentle ? ` data-gentle="true"` : ""} aria-hidden="true">
    <div class="epb-cutin-lines"></div>
    <div class="epb-cutin-band">
      <img class="epb-cutin-portrait" src="${esc(cutInImage(payload?.img))}" alt="">
      <div class="epb-cutin-text">
        <span class="epb-cutin-name">${esc(payload?.name)}</span>
        <span class="epb-cutin-word">Decisive</span>
        ${list}
      </div>
    </div>
  </div>`;
}

/** The cut-in on screen now, so a second replaces it rather than stacking. */
let cutInShowing = null;

/**
 * Put the cut-in on this client's screen, above everything and never in the
 * way of a click, and take it down once it has played. Photosensitive mode
 * and the browser's reduced-motion preference both get the gentle version.
 */
function playCutIn(payload, { doc = globalThis.document, user = game.user } = {}) {
  if (!payload || !doc?.body) return null;
  const reducedMotion = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const gentle = photosensitive() || reducedMotion;
  cutInShowing?.remove();
  const layer = doc.createElement("div");
  layer.className = "epb-cutin-layer";
  layer.innerHTML = cutInMarkup(payload, {
    charms: cutInCharms(payload, user, cutInActor(payload)),
    gentle
  });
  doc.body.append(layer);
  cutInShowing = layer;
  setTimeout(() => {
    layer.remove();
    if (cutInShowing === layer) cutInShowing = null;
  }, gentle ? CUT_IN_DURATION_GENTLE : CUT_IN_DURATION);
  return layer;
}

/**
 * Wrap the roller's attack-animation step. The system's own step runs first
 * and its result is returned untouched; the cut-in comes after, and anything
 * that goes wrong in it is caught, so it can never break a roll.
 */
function wrapAttackSequence(RollForm, {
  emit = (message) => game.socket?.emit(CUT_IN_SOCKET, message),
  play = playCutIn,
  show = shouldShowCutIn
} = {}) {
  const prototype = RollForm?.prototype;
  const original = prototype?.attackSequence;
  if (typeof original !== "function" || original.epbCutIn) return false;
  const wrapped = function (...args) {
    const result = original.apply(this, args);
    let payload = null;
    try {
      payload = cutInPayload(this);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not read the roll for the decisive cut-in`, err);
    }
    if (!payload) return result;
    try {
      emit({ type: CUT_IN_MESSAGE, payload });
    } catch (err) {
      console.warn(`${MODULE_ID} | could not send the decisive cut-in`, err);
    }
    try {
      if (show(payload)) play(payload);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not play the decisive cut-in`, err);
    }
    return result;
  };
  wrapped.epbCutIn = true;
  prototype.attackSequence = wrapped;
  return true;
}

/** A cut-in sent by another client: cleaned, then shown if this client should. */
function receiveCutIn(message, { play = playCutIn, show = shouldShowCutIn } = {}) {
  if (message?.type !== CUT_IN_MESSAGE) return;
  try {
    const payload = cleanCutInPayload(message.payload);
    if (payload && show(payload)) play(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not play a received decisive cut-in`, err);
  }
}

/* -------------------------------------------- */
/*  Anima colours                               */
/* -------------------------------------------- */

/**
 * The colour of a character's anima, for the cut-in, the flare and callouts.
 *
 * A colour picked on the sheet always wins. Most sheets leave it at the
 * system's default white, though, so this finds one that fits the character:
 * from the caste or aspect written on the sheet ("Wood Aspect" is green, "Night
 * Caste" midnight blue), then a Liminal's nature, then colour words in their
 * anima descriptions ("a burning phoenix"), and last their Exalt type.
 *
 * The caste is typed freely, so words are matched loosely: a word counts when it
 * is a keyword, is a longer keyword with a short ending ("flames", "moonlit"),
 * or is one letter away from a keyword of five letters or more ("Jorneys").
 */
const ANIMA_TYPE_COLORS = {
  solar: "#F2B233",
  lunar: "#A9C1E8",
  sidereal: "#9B7FE6",
  dragonblooded: "#E0662E",
  abyssal: "#8C1F3B",
  alchemical: "#D9A441",
  infernal: "#3DDC84",
  getimian: "#6FC7C0",
  liminal: "#7FA8A3",
  exigent: "#E5B356",
  dragonking: "#9CBF3B",
  dreamsouled: "#E07AD0",
  umbral: "#5B4A8A",
  hearteater: "#B3263A",
  godblooded: "#F0D27A"
};

/** Castes, aspects and natures, under the Exalt type they belong to. */
const ANIMA_CASTE_COLORS = {
  solar: { dawn: "#F28C28", zenith: "#F7D046", twilight: "#6A7BD9", night: "#3A4A8C", eclipse: "#B59BD9" },
  lunar: { "no moon": "#3B4A7A", full: "#E8D9A0", changing: "#B58BE0", casteless: "#A9C1E8" },
  sidereal: { journeys: "#E8B53A", serenity: "#6FC3E8", battles: "#D9483B", secrets: "#4FB06A", endings: "#7E4FB0" },
  dragonblooded: { air: "#9FD3F2", earth: "#C8963E", fire: "#E8452C", water: "#2E6FD9", wood: "#3DAA4A" },
  abyssal: { dusk: "#C2452D", midnight: "#2B2340", daybreak: "#D9C27A", day: "#BFB8A0", moonshadow: "#7A6FA8" },
  alchemical: {
    orichalcum: "#E0A12E", moonsilver: "#A9C1E8", starmetal: "#3FB8B0",
    jade: "#3DAA6A", soulsteel: "#4A4E6A", adamant: "#C9C3E6"
  },
  infernal: { slayer: "#D9362B", malefactor: "#4FBF4F", defiler: "#8A3FB0", fiend: "#E86A2E", scourge: "#C23F7A" },
  getimian: { spring: "#7CC85A", summer: "#F2C23A", autumn: "#D9722E", winter: "#8FC3E6" },
  liminal: { blood: "#B3263A", breath: "#9FD3F2", flesh: "#E08A8A", marrow: "#E6DDBF", soil: "#8A6A3E" }
};

/** Every caste together, for a caste written under a different Exalt type. */
const ANIMA_ANY_CASTE_COLORS = Object.assign({}, ...Object.values(ANIMA_CASTE_COLORS));

/** Words that name or suggest a colour, for a caste or an anima description. */
const ANIMA_WORD_COLORS = {
  red: "#D9362B", crimson: "#C2203A", scarlet: "#D9362B", ruby: "#C2203A", blood: "#B3263A",
  orange: "#E8862E", amber: "#E8A03A", copper: "#C8763E", bronze: "#B8863E",
  gold: "#F2B233", golden: "#F2B233", sun: "#F2B233", sunlight: "#F7C846",
  orichalcum: "#E0A12E", yellow: "#F2D046",
  green: "#3DAA4A", emerald: "#2E9E5A", jade: "#3DAA6A", leaf: "#5CB84A",
  forest: "#2E7D3A", verdant: "#4CB050", wood: "#3DAA4A",
  blue: "#2E6FD9", sapphire: "#2E5FC9", azure: "#3F8FE8", sea: "#2E6FD9",
  ocean: "#2560B8", wave: "#3F8FE8", tide: "#3F8FE8", water: "#2E6FD9",
  sky: "#8FC8F2", wind: "#9FD3F2", storm: "#7FA3D9", lightning: "#BFD9F2", air: "#9FD3F2",
  purple: "#8A5FD0", violet: "#8A5FD0", amethyst: "#9B6FD9", lilac: "#B59BD9",
  pink: "#E07AA8", rose: "#E07AA8",
  black: "#3E3558", shadow: "#4A3F6B", darkness: "#3E3558", void: "#3A2F5A", obsidian: "#3E3A4A",
  silver: "#A9C1E8", moon: "#A9C1E8", moonlight: "#B8CCEB", pearl: "#D6D0E6",
  white: "#B8CCEB", frost: "#9FC8E8", ice: "#9FC8E8", snow: "#B8D4EB",
  fire: "#E8552C", flame: "#E8552C", burning: "#E8552C", ember: "#E0662E",
  blaze: "#E8552C", inferno: "#D9452C", phoenix: "#E8662C",
  earth: "#C8963E", stone: "#9A8A6E", sand: "#D9B46E",
  star: "#6FC3E8", starlight: "#8FD0EB", starmetal: "#3FB8B0",
  teal: "#3FB8B0", turquoise: "#3FC3B8",
  bone: "#E6DDBF", ivory: "#E6DDBF", brown: "#8A6A3E"
};

/** A colour picked on the sheet, or null for none or the default white. */
function sheetAnimaColor(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  const number = parseInt(match[1], 16);
  const channels = [number >> 16, number >> 8, number].map((c) => c & 0xff);
  if (Math.min(...channels) > 225) return null;
  return `#${match[1].toUpperCase()}`;
}

/** The words in some text: lowercase letters only, markup dropped. */
function colorWords(text) {
  if (typeof text !== "string") return [];
  return text.toLowerCase().replace(/<[^>]*>/g, " ").match(/[a-z]+/g) ?? [];
}

/** Are two words one inserted, dropped or changed letter apart? */
function oneEditApart(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * The colour of the keyword a word is closest to, or null. An exact keyword
 * first; then the longest keyword the word starts with, allowing an ending of
 * up to three letters - but only for keywords of four letters or more, so
 * "season" is not "sea" and "redeemer" is not "red"; then a keyword of five or
 * more letters one letter away.
 */
function closestColorWord(word, table) {
  if (!word) return null;
  if (Object.hasOwn(table, word)) return table[word];
  let prefix = null;
  for (const key of Object.keys(table)) {
    if (key.includes(" ") || key.length < 4) continue;
    if (word.startsWith(key) && word.length - key.length <= 3
      && (!prefix || key.length > prefix.length)) {
      prefix = key;
    }
  }
  if (prefix) return table[prefix];
  if (word.length >= 5) {
    const near = Object.keys(table).find((key) =>
      key.length >= 5 && !key.includes(" ") && oneEditApart(word, key));
    if (near) return table[near];
  }
  return null;
}

/** The colour for some text: a two-word keyword first, then word by word, in order. */
function colorFromText(text, table) {
  const words = colorWords(text);
  if (!words.length) return null;
  const joined = ` ${words.join(" ")} `;
  for (const key of Object.keys(table)) {
    if (key.includes(" ") && joined.includes(` ${key} `)) return table[key];
  }
  for (const word of words) {
    const color = closestColorWord(word, table);
    if (color) return color;
  }
  return null;
}

/** The colour for a character's anima, as described at the top of this section. */
function animaColorFor(actor) {
  const system = actor?.system ?? {};
  const details = system.details ?? {};
  const own = sheetAnimaColor(details.animacolor);
  if (own) return own;

  const type = typeof details.exalt === "string" ? details.exalt : "";
  const fromCaste = colorFromText(details.caste, ANIMA_CASTE_COLORS[type] ?? {})
    ?? colorFromText(details.caste, ANIMA_ANY_CASTE_COLORS)
    ?? colorFromText(details.caste, ANIMA_WORD_COLORS);
  if (fromCaste) return fromCaste;

  const natures = ANIMA_CASTE_COLORS.liminal;
  if (type === "liminal" && Object.hasOwn(natures, details.nature)) return natures[details.nature];

  const anima = system.anima ?? {};
  const descriptions = [anima.iconic, anima.active, anima.passive]
    .filter((text) => typeof text === "string").join(" ");
  const fromAnima = colorFromText(descriptions, ANIMA_WORD_COLORS);
  if (fromAnima) return fromAnima;

  return ANIMA_TYPE_COLORS[type] ?? CUT_IN_FALLBACK;
}

/* -------------------------------------------- */
/*  Filling anima colours in on sheets          */
/* -------------------------------------------- */

/**
 * The Storyteller's button in Module Settings: write the colour this module
 * matched to each character into their sheet, so the system's own anima glow
 * matches the cut-in, the flare and the callouts.
 *
 * Only sheets still on the system's default white are touched - a colour
 * anyone has picked is left exactly as it is - and the window lists every
 * sheet it would change before anything is written.
 */
const FILL_LIST_MAX = 40;

/** Sheets still on the default white, with the colour that fits each. */
function animaColorPlan(actors) {
  const list = actors ? [...actors] : [];
  return list
    .filter((actor) => actor?.system?.details
      && !sheetAnimaColor(actor.system.details.animacolor))
    .map((actor) => ({
      id: actor.id ?? null,
      name: typeof actor.name === "string" ? actor.name : "",
      color: animaColorFor(actor)
    }));
}

/** That plan as Foundry document updates. */
function animaColorUpdates(plan) {
  return (plan ?? [])
    .filter((entry) => entry?.id)
    .map((entry) => ({ _id: entry.id, "system.details.animacolor": cutInColor(entry.color) }));
}

/** Write the plan, in one update, and report how many sheets were filled in. */
async function applyAnimaColors(plan, { update } = {}) {
  const updates = animaColorUpdates(plan);
  if (!updates.length) return 0;
  const write = update
    ?? ((documents) => getDocumentClass("Actor").updateDocuments(documents));
  await write(updates);
  return updates.length;
}

/** What the window shows before anything is written. */
function animaColorPlanMarkup(plan) {
  const list = plan ?? [];
  if (!list.length) {
    return "<p>Every sheet already has an anima colour picked, so there is "
      + "nothing to fill in.</p>";
  }
  const rows = list.slice(0, FILL_LIST_MAX).map((entry) => {
    const color = cutInColor(entry.color);
    return `<li style="display:flex;align-items:center;gap:8px;padding:2px 0">
      <span style="width:16px;height:16px;border-radius:3px;flex:none;background:${color};
        box-shadow:0 0 6px ${color}"></span>
      <span style="flex:1">${esc(entry.name)}</span>
      <code>${esc(color)}</code>
    </li>`;
  }).join("");
  const more = list.length - Math.min(list.length, FILL_LIST_MAX);
  return `<p>${list.length} sheet${list.length === 1 ? " is" : "s are"} still on the
      system's default white. Each will be set to the colour matched from its caste,
      its anima, or its Exalt type. Sheets with a colour already picked are left alone.</p>
    <ul style="list-style:none;margin:0;padding:0;max-height:320px;overflow:auto">${rows}</ul>
    ${more > 0 ? `<p>and ${more} more</p>` : ""}`;
}

/** The window behind the Module Settings button. */
class AnimaColorFiller extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "essence-poise-break-anima-colours",
    classes: ["essence-poise-break"],
    tag: "div",
    window: {
      title: "Fill in anima colours",
      icon: "fa-solid fa-palette",
      resizable: false
    },
    position: { width: 440, height: "auto" },
    actions: { fill: AnimaColorFiller.#onFill }
  };

  get plan() {
    return animaColorPlan(game.actors ?? []);
  }

  async _renderHTML() {
    const plan = this.plan;
    return `${animaColorPlanMarkup(plan)}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
        <button type="button" data-action="fill"${plan.length ? "" : " disabled"}>
          Fill in ${plan.length} sheet${plan.length === 1 ? "" : "s"}
        </button>
      </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  /** Nothing is written until this is pressed. */
  static async #onFill() {
    try {
      const filled = await applyAnimaColors(this.plan);
      ui.notifications.info(
        `Anima colours filled in on ${filled} sheet${filled === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error(`${MODULE_ID} | could not fill in anima colours`, err);
      ui.notifications.error("Could not fill in the anima colours; see the console.");
    }
    this.close();
  }
}

/* -------------------------------------------- */
/*  The anima flare                             */
/* -------------------------------------------- */

/**
 * The anima flare: when a character's anima rises into Bonfire, or on into
 * Iconic, a column of light in their anima colour erupts from their token, and
 * a caption and an edge glow mark it on screen.
 *
 * The level comes from the system, which derives it from the anima value each
 * time the actor is prepared, so nothing here repeats its thresholds. The
 * client that changes an actor notes the level before the change
 * (preUpdateActor) and reads it after (updateActor). If it rose into a flare,
 * that client plays it and sends it to everyone else over the module's socket,
 * and each client decides whether its player can see the token.
 */
const FLARE_MESSAGE = "animaFlare";
/** Matched by the caption's animations in styles/anima-flare.css. */
const FLARE_DURATION = 2200;
const FLARE_DURATION_GENTLE = 3000;
const FLARE_EMBERS = 18;
const FLARE_EMBERS_GENTLE = 6;
/** How far the column rises, in token radii. */
const FLARE_HEIGHT = 7;
const FLARE_ICONIC_MAX = 110;
/** The system's anima levels, lowest first; "" is no anima showing. */
const ANIMA_LEVELS = ["", "dim", "glowing", "burning", "bonfire", "iconic"];
const FLARE_RANK = ANIMA_LEVELS.indexOf("bonfire");

function showingFlare() {
  try {
    return !!game.settings.get(MODULE_ID, "animaFlare");
  } catch (err) {
    return false;
  }
}

/** Where an anima level sits in the system's order. Anything unknown is none. */
function animaRank(level) {
  const rank = ANIMA_LEVELS.indexOf(level);
  return rank === -1 ? 0 : rank;
}

/**
 * A rise into Bonfire, or on into Iconic. The system's alternate anima track
 * goes from burning straight to iconic, which counts too.
 */
function crossesIntoFlare(from, to) {
  return to >= FLARE_RANK && to > from;
}

/** The first sentence of a sheet's iconic anima, as plain text short enough to read. */
function iconicLine(value) {
  if (typeof value !== "string") return "";
  const plain = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return "";
  const sentence = /^.+?[.!?](?=\s|$)/.exec(plain)?.[0] ?? plain;
  return sentence.length > FLARE_ICONIC_MAX
    ? `${sentence.slice(0, FLARE_ICONIC_MAX - 1).trimEnd()}…`
    : sentence;
}

function flareLevelLabel(level) {
  return level === "iconic" ? "Iconic" : "Bonfire";
}

/**
 * What a flare carries, made safe. Like the cut-in it can arrive from another
 * client, so the level must be one that flares, the token and scene must be
 * named, the colour is checked and the iconic text is made plain.
 */
function cleanFlarePayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const name = text(raw.name, 80);
  const tokenId = text(raw.tokenId, 64);
  const sceneId = text(raw.sceneId, 64);
  const level = raw.level === "bonfire" || raw.level === "iconic" ? raw.level : null;
  if (!name || !tokenId || !sceneId || !level) return null;
  return {
    actorUuid: text(raw.actorUuid, 200) || null,
    tokenId,
    sceneId,
    name,
    color: cutInColor(raw.color),
    level,
    iconic: iconicLine(raw.iconic)
  };
}

/**
 * The flare for an actor now in Bonfire or Iconic, or null when there is no
 * token for it to erupt from. An unlinked token's actor carries its own token;
 * a linked actor's is looked for on this client's scene. An antagonist's iconic
 * anima text stays with the Storyteller.
 */
function animaFlarePayload(actor) {
  if (!actor) return null;
  const level = actor.system?.anima?.level;
  if (animaRank(level) < FLARE_RANK) return null;
  let token = null;
  try {
    token = actor.token ?? actor.getActiveTokens?.()?.[0] ?? null;
  } catch (err) {
    token = null;
  }
  const tokenDocument = token?.document ?? token;
  return cleanFlarePayload({
    actorUuid: actor.uuid,
    tokenId: tokenDocument?.id,
    sceneId: tokenDocument?.parent?.id,
    name: actor.name,
    color: animaColorFor(actor),
    level,
    iconic: actor.hasPlayerOwner ? actor.system?.anima?.iconic : ""
  });
}

/** Does this update set the anima value, nested or as a flattened key? */
function changesAnima(changes) {
  if (!changes || typeof changes !== "object") return false;
  if (Object.hasOwn(changes, "system.anima.value")) return true;
  const anima = changes.system?.anima;
  return !!anima && typeof anima === "object" && Object.hasOwn(anima, "value");
}

/** Each actor's anima rank just before this client changed it. */
const animaBefore = new Map();

/** preUpdateActor, on the client making the change: remember the level it had. */
function recordAnimaBefore(actor, changes, userId) {
  if (userId !== undefined && userId !== game.user?.id) return false;
  if (!actor?.uuid || !changesAnima(changes)) return false;
  animaBefore.set(actor.uuid, animaRank(actor.system?.anima?.level));
  return true;
}

/**
 * updateActor, on the same client: the system has worked out the new level by
 * now, so compare, and play and send the flare if it rose into one. Every step
 * after the comparison is caught, so a flare can never disturb an update.
 */
function animaAfterUpdate(actor, userId, {
  emit = (message) => game.socket?.emit(CUT_IN_SOCKET, message),
  play = playFlare,
  show = shouldShowFlare
} = {}) {
  if (userId !== undefined && userId !== game.user?.id) return null;
  if (!actor?.uuid || !animaBefore.has(actor.uuid)) return null;
  const from = animaBefore.get(actor.uuid);
  animaBefore.delete(actor.uuid);
  if (!crossesIntoFlare(from, animaRank(actor.system?.anima?.level))) return null;

  let payload = null;
  try {
    payload = animaFlarePayload(actor);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not read the actor for the anima flare`, err);
  }
  if (!payload) return null;
  try {
    emit({ type: FLARE_MESSAGE, payload });
  } catch (err) {
    console.warn(`${MODULE_ID} | could not send the anima flare`, err);
  }
  try {
    if (show(payload)) play(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not play the anima flare`, err);
  }
  return payload;
}

/** The flaring token, if it is on the scene this client is viewing. */
function flareToken(payload) {
  const board = globalThis.canvas;
  if (!payload?.tokenId || !board?.scene?.id || board.scene.id !== payload.sceneId) return null;
  return board.tokens?.get?.(payload.tokenId) ?? null;
}

/**
 * Should this client show the flare? It belongs to a place on the map, so only
 * for a token on the scene this player is viewing - and, as with Break,
 * Token#isVisible decides, so a hidden token gives nothing away.
 */
function shouldShowFlare(payload) {
  if (!payload || !showingFlare()) return false;
  const token = flareToken(payload);
  return !!token && !!token.isVisible && !token.destroyed;
}

/** The flare at progress t, from 0 to 1. */
function flareFrame(t, { gentle = false } = {}) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  if (gentle) {
    // Photosensitive mode: the column is there at once, faint, and only fades
    // in and out. No ring, no flicker.
    return {
      t: p,
      rise: 1,
      alpha: 0.55 * (p < 0.25 ? p / 0.25 : p > 0.6 ? Math.max(0, (1 - p) / 0.4) : 1),
      flicker: 1,
      glow: 0.6,
      ringScale: 1,
      ringAlpha: 0
    };
  }
  const burst = Math.min(1, p / 0.45);
  return {
    t: p,
    // Shoots up in the first fifth and a bit.
    rise: 1 - (1 - Math.min(1, p / 0.22)) ** 3,
    // Divided by (1 - 0.62), not 0.38: in floating point that reaches exactly
    // 0 at the end.
    alpha: p < 0.05 ? p / 0.05 : p > 0.62 ? Math.max(0, (1 - p) / (1 - 0.62)) : 1,
    flicker: p > 0.15 ? 1 + 0.07 * Math.sin(p * 90) : 1,
    glow: 1,
    ringScale: 1 + 2 * (1 - (1 - burst) ** 3),
    ringAlpha: p < 0.45 ? 0.9 * (1 - burst) : 0
  };
}

/** Embers rising through the column, laid out the same way each time for a token. */
function emberLayout(count, seed) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => ({
    offset: (random() - 0.5) * 1.0,
    drift: (random() - 0.5) * 0.4,
    speed: 0.55 + random() * 0.5,
    size: 0.025 + random() * 0.035,
    delay: random() * 0.35
  }));
}

/**
 * One frame of the flare, drawn into a PIXI.Graphics with the PIXI 7 API that
 * Foundry 14 bundles: a pool of light at the foot, the column as stacked bands
 * of a coloured sheath round a white-hot core, the ring, and the embers. Kept
 * apart from the canvas so it can be tested and previewed on its own.
 */
function drawFlare(graphics, layout, frame, radius, color) {
  graphics.clear();
  if (frame.alpha <= 0 && frame.ringAlpha <= 0) return;
  const core = mixColor(color, 0xFFFFFF, 0.7);
  const base = radius * 0.55;
  const height = radius * FLARE_HEIGHT * frame.rise;

  // Faintest where it is widest.
  for (let i = 3; i >= 1; i--) {
    graphics.beginFill(color, frame.alpha * frame.glow * 0.1 * (4 - i));
    graphics.drawCircle(0, base * 0.3, radius * (0.4 + 0.3 * i));
    graphics.endFill();
  }

  if (height > 0) {
    const bands = 16;
    const step = height / bands;
    for (let i = 0; i < bands; i++) {
      const along = i / bands;
      const fade = (1 - along) ** 1.6;
      const sheath = radius * 0.55 * frame.flicker * (1 - 0.45 * along);
      const top = base - step * (i + 1);
      // Each band exactly its own height. Overlapping them, in added light,
      // doubles the brightness where they meet and stripes the column.
      graphics.beginFill(color, frame.alpha * 0.5 * fade);
      graphics.drawRect(-sheath, top, sheath * 2, step);
      graphics.endFill();
      graphics.beginFill(core, frame.alpha * 0.85 * fade);
      graphics.drawRect(-sheath * 0.36, top, sheath * 0.72, step);
      graphics.endFill();
    }
  }

  if (frame.ringAlpha > 0) {
    graphics.lineStyle(Math.max(1, radius * 0.1 * (1 - frame.ringScale / 4)), core, frame.ringAlpha);
    graphics.drawCircle(0, base * 0.3, radius * frame.ringScale);
    graphics.lineStyle(0);
  }

  for (const ember of layout) {
    const p = (frame.t - ember.delay) / (1 - ember.delay);
    if (p <= 0 || p >= 1) continue;
    graphics.beginFill(core, frame.alpha * (1 - p));
    graphics.drawCircle(
      radius * (ember.offset + ember.drift * p),
      base - radius * FLARE_HEIGHT * ember.speed * p,
      radius * ember.size
    );
    graphics.endFill();
  }
}

/** The flare's caption and edge glow. Every name in it is escaped. */
function flareCaptionMarkup(payload, { gentle = false } = {}) {
  const iconic = payload?.iconic
    ? `<span class="epb-flare-iconic">${esc(payload.iconic)}</span>`
    : "";
  return `<div class="epb-flare" style="--epb-flare-color: ${cutInColor(payload?.color)}"${
    gentle ? ` data-gentle="true"` : ""} aria-hidden="true">
    <div class="epb-flare-edges"></div>
    <div class="epb-flare-caption">
      <span class="epb-flare-level">${esc(flareLevelLabel(payload?.level))}</span>
      <span class="epb-flare-name">${esc(payload?.name)}</span>
      ${iconic}
    </div>
  </div>`;
}

/**
 * Play the column on one token, in the interface canvas group above the
 * tokens like the Break effect, and in added light, so it brightens the map
 * under it rather than covering it. Destroyed when it ends, or found already
 * destroyed if the canvas was torn down around it.
 */
async function playAnimaFlare(token, payload) {
  const pixi = globalThis.PIXI;
  const board = globalThis.canvas;
  const CanvasAnimation = foundry.canvas?.animation?.CanvasAnimation;
  if (!pixi || !board?.interface || !CanvasAnimation || !token?.center) return;

  const radius = Math.max(token.w ?? 0, token.h ?? 0) / 2;
  if (!radius) return;
  const gentle = board.photosensitiveMode === true || photosensitive();
  const color = parseInt(cutInColor(payload?.color).slice(1), 16);

  if (!gentle && token.hasDynamicRing && token.ring?.flashColor && foundry.utils?.Color) {
    token.ring.flashColor(foundry.utils.Color.from(color), { duration: 1400 })
      ?.catch?.(() => {});
  }

  const container = new pixi.Container();
  container.eventMode = "none";
  container.position.set(token.center.x, token.center.y);
  const graphics = container.addChild(new pixi.Graphics());
  if (pixi.BLEND_MODES) graphics.blendMode = pixi.BLEND_MODES.ADD;
  // Above the token layer, for the reason the Break effect gives.
  container.zIndex = CONFIG.Canvas?.groups?.interface?.zIndexScrollingText ?? 1100;
  board.interface.addChild(container);

  const layout = emberLayout(gentle ? FLARE_EMBERS_GENTLE : FLARE_EMBERS, seedFor(token.id));
  const state = { t: 0 };
  const draw = () => {
    if (graphics.destroyed) return;
    drawFlare(graphics, layout, flareFrame(state.t, { gentle }), radius, color);
  };

  try {
    draw();
    await CanvasAnimation.animate(
      [{ parent: state, attribute: "t", from: 0, to: 1 }],
      {
        name: `${MODULE_ID}.flare.${token.id}`,
        context: container,
        duration: gentle ? FLARE_DURATION_GENTLE : FLARE_DURATION,
        ontick: draw
      }
    );
  } catch (err) {
    console.error(`${MODULE_ID} | could not play the anima flare`, err);
  } finally {
    if (!container.destroyed) container.destroy({ children: true });
  }
}

/** The caption on screen now, so a second replaces it rather than stacking. */
let flareShowing = null;

/** Put the caption and edge glow on this client's screen, then take them down. */
function playFlareCaption(payload, { doc = globalThis.document } = {}) {
  if (!payload || !doc?.body) return null;
  const reducedMotion = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const gentle = photosensitive() || reducedMotion;
  flareShowing?.remove();
  const layer = doc.createElement("div");
  layer.className = "epb-flare-layer";
  layer.innerHTML = flareCaptionMarkup(payload, { gentle });
  doc.body.append(layer);
  flareShowing = layer;
  setTimeout(() => {
    layer.remove();
    if (flareShowing === layer) flareShowing = null;
  }, gentle ? FLARE_DURATION_GENTLE : FLARE_DURATION);
  return layer;
}

/** The whole flare on this client: the column at the token, and the caption. */
function playFlare(payload) {
  const token = flareToken(payload);
  if (!token) return null;
  playAnimaFlare(token, payload);
  return playFlareCaption(payload);
}

/** A flare sent by another client: cleaned, then shown if this client should. */
function receiveAnimaFlare(message, { play = playFlare, show = shouldShowFlare } = {}) {
  if (message?.type !== FLARE_MESSAGE) return;
  try {
    const payload = cleanFlarePayload(message.payload);
    if (payload && show(payload)) play(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not play a received anima flare`, err);
  }
}

/* -------------------------------------------- */
/*  Charm callouts                              */
/* -------------------------------------------- */

/**
 * Charm callouts: the moment a character uses a Charm, its name bursts from
 * their token in the carved lettering of the BREAK text, one name above
 * another when several go together.
 *
 * A Charm is used in one of two places, and each is wrapped the way the cut-in
 * wraps attackSequence - the system's own step runs unchanged, and nothing
 * that goes wrong here can reach it:
 *
 * - In a roll, the roller pays for the Charms added to it in
 *   _updateRollerResources(): when the dice are rolled, and again after a
 *   damage roll. Each roller calls a Charm out once.
 * - From the sheet, the actor's spendItem() pays for one. Only a Charm being
 *   used is called out; spendItem on an active Charm switches it off.
 *
 * The client that used the Charm plays the callout and sends it to everyone
 * else over the module's socket. As in the cut-in, an antagonist's Charm names
 * stay with the Storyteller unless the table chooses to name them.
 */
const CALLOUT_MESSAGE = "charmCallout";
const CALLOUT_DURATION = 1500;
const CALLOUT_DURATION_GENTLE = 2200;
/** How long after one name the next bursts out. */
const CALLOUT_STAGGER = 260;
/** Names called out together; any more are counted in a last line. */
const CALLOUT_MAX = 4;
/** The Charms a roller has already called out, so its second payment is quiet. */
const CALLED_OUT = Symbol("epbCalledOut");

function showingCallouts() {
  try {
    return !!game.settings.get(MODULE_ID, "charmCallouts");
  } catch (err) {
    return false;
  }
}

/** The names of the Charms among some items, trimmed and each once. */
function calloutNames(items) {
  if (!Array.isArray(items)) return [];
  return [...new Set(items
    .filter((item) => !item?.type || item.type === "charm")
    .map((item) => (typeof item?.name === "string" ? item.name.trim() : ""))
    .filter(Boolean))];
}

/** A callout for an actor's token, or null with no names or no token to call from. */
function calloutPayload(actor, token, names) {
  if (!actor || !names?.length) return null;
  const tokenDocument = token?.document ?? token;
  const payload = cleanCutInPayload({
    actorUuid: actor.uuid,
    tokenId: tokenDocument?.id,
    sceneId: tokenDocument?.parent?.id,
    name: actor.name,
    img: actor.img,
    color: animaColorFor(actor),
    charms: names,
    storyteller: !actor.hasPlayerOwner
  });
  return payload?.tokenId && payload.sceneId && payload.charms.length ? payload : null;
}

/** The callout for a roller paying for its Charms: only those it has not called out. */
function rollerCallout(form) {
  const actor = form?.actor;
  const charms = (form?.object?.addedCharms ?? [])
    .filter((item) => !item?.type || item.type === "charm");
  if (!actor || !charms.length) return null;
  const already = form[CALLED_OUT] ?? (form[CALLED_OUT] = new Set());
  const fresh = charms.filter((charm) => {
    const key = charm?.id ?? charm?._id ?? charm?.name;
    if (!key || already.has(key)) return false;
    already.add(key);
    return true;
  });
  if (!fresh.length) return null;
  let token = null;
  try {
    token = typeof form._getActorToken === "function" ? form._getActorToken() : null;
  } catch (err) {
    token = null;
  }
  return calloutPayload(actor, token, calloutNames(fresh));
}

/** The callout for a Charm used from the sheet. On an active Charm, spendItem switches it off. */
function sheetCallout(actor, item) {
  if (item?.type !== "charm" || item.system?.active) return null;
  let token = null;
  try {
    token = actor?.token ?? actor?.getActiveTokens?.()?.[0] ?? null;
  } catch (err) {
    token = null;
  }
  return calloutPayload(actor, token, calloutNames([item]));
}

/** Only for a token this client can see, on the scene it is viewing. */
function shouldShowCallouts(payload) {
  if (!payload || !showingCallouts()) return false;
  const token = flareToken(payload);
  return !!token && !!token.isVisible && !token.destroyed;
}

/** Send to everyone else and play here, each step caught on its own. */
function sendCallouts(payload, { emit, play, show }) {
  if (!payload) return;
  try {
    emit({ type: CALLOUT_MESSAGE, payload });
  } catch (err) {
    console.warn(`${MODULE_ID} | could not send a Charm callout`, err);
  }
  try {
    if (show(payload)) play(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not play a Charm callout`, err);
  }
}

const emitOnSocket = (message) => game.socket?.emit(CUT_IN_SOCKET, message);

/** Wrap the roller's payment for a roll. Its own step runs first, and its result is returned. */
function wrapRollerResources(RollForm, {
  emit = emitOnSocket, play = playCallouts, show = shouldShowCallouts
} = {}) {
  const prototype = RollForm?.prototype;
  const original = prototype?._updateRollerResources;
  if (typeof original !== "function" || original.epbCallouts) return false;
  const wrapped = function (...args) {
    const result = original.apply(this, args);
    let payload = null;
    try {
      payload = rollerCallout(this);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not read the roll for Charm callouts`, err);
    }
    sendCallouts(payload, { emit, play, show });
    return result;
  };
  wrapped.epbCallouts = true;
  prototype._updateRollerResources = wrapped;
  return true;
}

/**
 * Wrap the actor's spending of one item. Whether the Charm is being used is
 * read before the system runs, since it may switch the Charm on; an error the
 * system itself throws still reaches whoever called it.
 */
function wrapSpendItem(ActorClass, {
  emit = emitOnSocket, play = playCallouts, show = shouldShowCallouts
} = {}) {
  const prototype = ActorClass?.prototype;
  const original = prototype?.spendItem;
  if (typeof original !== "function" || original.epbCallouts) return false;
  const wrapped = function (item, ...rest) {
    let payload = null;
    try {
      payload = sheetCallout(this, item);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not read the Charm for a callout`, err);
    }
    const result = original.call(this, item, ...rest);
    sendCallouts(payload, { emit, play, show });
    return result;
  };
  wrapped.epbCallouts = true;
  prototype.spendItem = wrapped;
  return true;
}

/** One name at progress t, from 0 to 1. */
function calloutFrame(t, { gentle = false } = {}) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  if (gentle) {
    // Photosensitive mode: no burst. It fades in where it rests, then out.
    return {
      alpha: p < 0.25 ? p / 0.25 : p > 0.7 ? Math.max(0, (1 - p) / (1 - 0.7)) : 1,
      scale: 1,
      rise: p > 0.7 ? (p - 0.7) / (1 - 0.7) : 0,
      tint: 1
    };
  }
  const landing = Math.min(1, p / 0.14);
  return {
    alpha: p < 0.06 ? p / 0.06 : p > 0.68 ? Math.max(0, (1 - p) / (1 - 0.68)) : 1,
    scale: p < 0.14 ? 1.7 - 0.7 * (1 - (1 - landing) ** 3) : 1,
    rise: p > 0.55 ? (p - 0.55) / (1 - 0.55) : 0,
    tint: Math.min(1, p / 0.2)
  };
}

/** The lines to call out: the first few names, and a count of the rest. */
function calloutLines(names) {
  const shown = names.slice(0, CALLOUT_MAX);
  const more = names.length - shown.length;
  return more > 0 ? [...shown, `+${more} more`] : shown;
}

/** A name's size, in pixels at scene scale. */
const CALLOUT_SIZE_MIN = 30;
const CALLOUT_SIZE_MAX = 68;

/**
 * Big enough to read at a glance with the map zoomed out - the first size,
 * about a third of the token's radius, was too small to read at the table -
 * and still bounded over a very large token.
 */
function calloutSize(radius) {
  return Math.round(Math.min(CALLOUT_SIZE_MAX,
    Math.max(CALLOUT_SIZE_MIN, (Number(radius) || 0) * 0.7)));
}

/**
 * Where each line is, elapsed ms into the callout: staggered in time, stacked
 * upward from just above the token, each rising a little as it fades.
 */
function calloutLayout(elapsed, count, { gentle = false, radius, size, hue }) {
  const duration = gentle ? CALLOUT_DURATION_GENTLE : CALLOUT_DURATION;
  return Array.from({ length: count }, (_, i) => {
    const frame = calloutFrame((elapsed - i * CALLOUT_STAGGER) / duration, { gentle });
    return {
      alpha: frame.alpha,
      scale: frame.scale,
      tint: mixColor(CRACK_LIGHT, hue, 0.55 * frame.tint),
      x: 0,
      y: -radius * (1.05 + 0.2 * frame.rise) - size * 1.15 * i
    };
  });
}

/**
 * Call out some lines over one token, at Foundry's floating-text level like
 * the BREAK text, and destroy them when done. A second callout on the same
 * token replaces the first.
 */
async function playCalloutsOnToken(token, lines, color) {
  const pixi = globalThis.PIXI;
  const board = globalThis.canvas;
  const CanvasAnimation = foundry.canvas?.animation?.CanvasAnimation;
  if (!pixi || !board?.interface || !CanvasAnimation || !token?.center || !lines?.length) return;

  const radius = Math.max(token.w ?? 0, token.h ?? 0) / 2;
  if (!radius) return;
  const gentle = board.photosensitiveMode === true || photosensitive();
  const hue = parseInt(cutInColor(color).slice(1), 16);
  const size = calloutSize(radius);
  const style = breakTextStyle(pixi, size);
  const TextClass = foundry.canvas?.containers?.PreciseText ?? pixi.Text;

  const container = new pixi.Container();
  container.eventMode = "none";
  container.position.set(token.center.x, token.center.y);
  container.zIndex = CONFIG.Canvas?.groups?.interface?.zIndexScrollingText ?? 1100;
  const labels = lines.map((line) => {
    const text = container.addChild(new TextClass(line, style));
    text.anchor.set(0.5, 1);
    return text;
  });
  board.interface.addChild(container);

  const duration = gentle ? CALLOUT_DURATION_GENTLE : CALLOUT_DURATION;
  const total = duration + (labels.length - 1) * CALLOUT_STAGGER;
  const state = { t: 0 };
  const draw = () => {
    if (container.destroyed) return;
    const layout = calloutLayout(state.t * total, labels.length, { gentle, radius, size, hue });
    labels.forEach((text, i) => {
      if (text.destroyed) return;
      text.alpha = layout[i].alpha;
      text.scale.set(layout[i].scale);
      text.tint = layout[i].tint;
      text.position.set(layout[i].x, layout[i].y);
    });
  };

  try {
    draw();
    await CanvasAnimation.animate(
      [{ parent: state, attribute: "t", from: 0, to: 1 }],
      {
        name: `${MODULE_ID}.callout.${token.id}`,
        context: container,
        duration: total,
        ontick: draw
      }
    );
  } catch (err) {
    console.error(`${MODULE_ID} | could not play the Charm callout`, err);
  } finally {
    if (!container.destroyed) container.destroy({ children: true });
  }
}

/** A callout on this client: the names this user may see, over the token. */
function playCallouts(payload, { user = game.user } = {}) {
  const token = flareToken(payload);
  if (!token) return null;
  const names = cutInCharms(payload, user, cutInActor(payload));
  if (!names.length) return null;
  return playCalloutsOnToken(token, calloutLines(names), payload.color);
}

/** A callout sent by another client: cleaned, then shown if this client should. */
function receiveCallouts(message, { play = playCallouts, show = shouldShowCallouts } = {}) {
  if (message?.type !== CALLOUT_MESSAGE) return;
  try {
    const clean = cleanCutInPayload(message.payload);
    const payload = clean?.tokenId && clean.sceneId && clean.charms.length ? clean : null;
    if (payload && show(payload)) play(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not play a received Charm callout`, err);
  }
}

/* -------------------------------------------- */
/*  The panel                                   */
/* -------------------------------------------- */

class TurnPanel extends ApplicationV2 {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
    /** Which weapon's gambit list is open, by uuid. */
    this.openGambit = null;
    /**
     * The target and its state at the last render, so the render that first
     * finds a target in Break can mark it, and the shards crack once.
     */
    this.lastTarget = null;
  }

  static DEFAULT_OPTIONS = {
    id: "essence-poise-break-panel",
    classes: ["essence-poise-break"],
    tag: "div",
    window: {
      title: "Poise & Break",
      icon: "fa-solid fa-khanda",
      resizable: false
    },
    position: { width: 360, height: "auto" },
    actions: {
      attack: TurnPanel.#onAttack,
      gambitMenu: TurnPanel.#onGambitMenu,
      gambit: TurnPanel.#onGambit,
      roll: TurnPanel.#onRoll
    }
  };

  /** The system's roller is opened exactly as its own hotbar macros do. */
  static async #onAttack(event, element) {
    const { uuid, attack } = element.dataset;
    const api = game.exaltedessence;
    if (!api?.weaponAttack) {
      ui.notifications.error("Exalted Essence's roller API was not found.");
      return;
    }
    await api.weaponAttack(uuid, attack);
    this.constructor.checkAgainstRoller(this.prediction);
  }

  /** Show or hide the gambit list under one weapon. */
  static async #onGambitMenu(event, element) {
    const { uuid } = element.dataset;
    this.openGambit = this.openGambit === uuid ? null : uuid;
    this.render();
  }

  /**
   * Open the roller on a gambit that is already chosen and already paid for.
   *
   * The roller recomputes powerSpent only when the selection changes, so
   * setting both here is what makes the pre-selection stick - and is why the
   * cost must be the one the system would have reached itself.
   */
  static async #onGambit(event, element) {
    const { uuid, gambit, power } = element.dataset;
    const RollForm = game.exaltedessence?.RollForm;
    if (!RollForm) {
      ui.notifications.error("Exalted Essence's roller API was not found.");
      return;
    }
    const weapon = await fromUuid(uuid);
    if (!weapon?.parent) {
      ui.notifications.warn(`Could not find the weapon ${uuid}.`);
      return;
    }

    const form = new RollForm(
      weapon.parent,
      { classes: [" exaltedessence exaltedessence-dialog dice-roller"] },
      {},
      { rollType: "gambit", weapon: weapon.system }
    );
    form.object.gambit = gambit;
    form.object.powerSpent = Number(power) || 0;
    resolveMissingGambits(form);
    // Assign the form, not the promise render() returns: the drift check reads
    // game.rollForm.object.
    game.rollForm = form;
    await form.render(true);
    this.openGambit = null;
    this.constructor.checkAgainstRoller(this.prediction);
  }

  /**
   * Compare what the panel advised against what the roller actually computed.
   *
   * targetNumbers() mirrors the system's condition modifiers, so it can fall
   * out of step when the system changes. The roller is the authority, and it
   * publishes its working on game.rollForm, so the moment a player rolls we
   * can tell whether the advice still matches - and say so with both numbers
   * rather than leaving them to wonder why it felt wrong.
   *
   * Purely diagnostic: any failure here is swallowed, because a broken check
   * must never break a roll.
   */
  static checkAgainstRoller(prediction) {
    if (!prediction) return;
    setTimeout(async () => {
      try {
        // The system sets game.rollForm to the promise render() returns, so
        // reading .object straight off it finds undefined and the check
        // silently never runs. Await anything thenable first.
        const form = game.rollForm;
        const settled = typeof form?.then === "function" ? await form : form;
        const rolled = settled?.object;
        if (!rolled || rolled.target?.actor?.id !== prediction.targetId) return;

        const differences = [];
        if (Number.isFinite(rolled.defense) && rolled.defense !== prediction.defense) {
          differences.push(`Defense: panel ${prediction.defense}, roller ${rolled.defense}`);
        }
        if (usingReforged() && Number.isFinite(rolled.poise) &&
            rolled.poise !== prediction.poise) {
          differences.push(`Poise: panel ${prediction.poise}, roller ${rolled.poise}`);
        }
        if (!differences.length) return;

        console.warn(
          `${MODULE_ID} | condition maths out of step with the system `
          + `(checked against ${SYSTEM_ID} ${VERIFIED_SYSTEM}, this world runs `
          + `${game.system.version}): ${differences.join(" | ")}. `
          + "Fix targetNumbers() in scripts/turn-panel.js."
        );
        if (!driftWarned) {
          driftWarned = true;
          ui.notifications.warn(
            `Poise & Break: ${differences[0]}. Its condition maths may be out of `
            + "step with the system - see the console."
          );
        }
      } catch (err) {
        // Diagnostics must never interfere with play.
      }
    }, 600);
  }

  static async #onRoll(event, element) {
    const { rollType, ability } = element.dataset;
    const RollForm = game.exaltedessence?.RollForm;
    if (!RollForm) {
      ui.notifications.error("Exalted Essence's roller API was not found.");
      return;
    }
    // Casting is not its own roll in Essence: an attack spell is a normal
    // attack with Sagacity in place of a combat Ability, and the roller takes
    // an ability and treats the weapon as optional.
    const data = ability ? { rollType, ability } : { rollType };
    const form = new RollForm(
      this.actor,
      { classes: [" exaltedessence exaltedessence-dialog dice-roller"] },
      {},
      data
    );
    game.rollForm = form;
    await form.render(true);
    if (ability) this.constructor.checkAgainstRoller(this.prediction);
  }

  async _renderHTML() {
    return this.#markup();
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  /* ---------------------------------------- */

  #markup() {
    const actor = this.actor;
    const reforged = usingReforged();
    const target = currentTarget();
    const { allow, why, state } = legality(target, reforged);
    // Disarm is priced off the target's Defense, so the gambit list needs the
    // same adjusted number the verdict quotes.
    const { defense } = targetNumbers(target, reforged);

    // Only the render that first finds this target in Break marks it, so the
    // shards crack once rather than on every refresh.
    const justBroke = !!target && state === "break"
      && this.lastTarget?.id === target.id && this.lastTarget.state === "standing";
    this.lastTarget = target ? { id: target.id, state } : null;
    const faceoff = [
      `data-state="${state}"`,
      justBroke ? `data-just-broke="true"` : "",
      photosensitive() ? `data-gentle="true"` : ""
    ].filter(Boolean).join(" ");

    // The target and the verdict share one card: who they are, then what to do
    // about it.
    return [
      this.#selfBlock(actor, reforged),
      `<div class="epb-faceoff" ${faceoff}>`,
      this.#targetBlock(target, state, reforged),
      this.#verdictBlock(actor, target, state, reforged),
      `</div>`,
      this.#attackBlock(actor, allow, why, target, defense, reforged),
      this.#sorceryBlock(actor, allow, why),
      this.#socialBlock(target),
      this.#otherBlock(),
      this.#footer(reforged, target)
    ].join("");
  }

  #selfBlock(actor, reforged) {
    const power = actor.system?.power ?? { value: 0, max: 10 };
    const motes = actor.system?.motes ?? { value: 0, max: 0 };
    const poise = actor.system?.poise ?? { value: 0, max: 0 };
    const hardness = actor.system?.hardness?.value ?? 0;
    const broken = inBreak(actor);

    // Your Poise as shards beside your name: under Combat Reforged it is the
    // thing standing between you and Break.
    const guard = reforged
      ? `<span class="epb-guard">${poiseShards(poise.value, poise.max, { broken, small: true })}
           <span class="epb-guard-num"><b>${poise.value}</b>/${poise.max} Poise</span></span>`
      : `<span class="epb-guard"><span class="epb-guard-num"><b>${hardness}</b> Hardness</span></span>`;

    const brokenNote =
      reforged && broken
        ? `<p class="epb-note epb-break">You are in Break. Power you gain refills Poise
             first — ${Math.max(0, (poise.max ?? 0) - (poise.value ?? 0))} to go.
             Only decisive attacks can target you.</p>`
        : "";

    return `
      <section class="epb-self">
        <div class="epb-self-head">
          <h3>${esc(actor.name)}</h3>
          ${guard}
        </div>
        <div class="epb-stats">
          <span class="epb-stat epb-stat-power"><b>${power.value}</b>/${power.max ?? 10} Power</span>
          <span class="epb-stat"><b>${motes.value}</b>/${motes.max ?? 0} motes</span>
        </div>
        ${brokenNote}
      </section>`;
  }

  #targetBlock(target, state, reforged) {
    if (!target) {
      return `
        <section class="epb-target epb-none">
          <p class="epb-label">Target</p>
          <p class="epb-note">Target a token first. The roller reads their Defense,
             Soak and Poise from your target.</p>
        </section>`;
    }

    const chips = {
      break: ["In Break", "epb-chip-break", "Poise 0 — only decisive attacks."],
      standing: [
        "Standing",
        "epb-chip-standing",
        "Wither them until your extra successes reach their Poise."
      ],
      group: ["Battle group", "epb-chip-group", "No Poise. Always decisive."],
      standard: [
        `Hardness ${target.system?.hardness?.value ?? 0}`,
        "epb-chip-standard",
        "Standard rules: a decisive attack needs Power at least equal to Hardness."
      ]
    };
    const [label, cls, hint] = chips[state] ?? chips.standard;

    // Poise is only drawn while it matters: a target who has it, or has just
    // lost it. Battle groups have none, and standard rules use Hardness.
    const poise = target.system?.poise ?? {};
    const shown = Math.max(Number(poise.max) || 0, Number(poise.value) || 0);
    const broken = state === "break";
    const meter = (state === "standing" || broken) && shown
      ? `<span class="epb-target-poise">${poiseShards(poise.value, poise.max, { broken })}
           <span class="epb-poise-num"><b>${broken ? 0 : poise.value ?? 0}</b>/${shown}</span></span>`
      : "";

    return `
      <section class="epb-target">
        <p class="epb-label">Target</p>
        <div class="epb-target-row">
          <p class="epb-target-name">${esc(target.name)}</p>
          ${meter}
        </div>
        <p><span class="epb-chip ${cls}">${label}</span></p>
        <p class="epb-note">${hint}</p>
      </section>`;
  }

  /**
   * The panel's opinion, rather than a menu. Names the move, does the one sum
   * that decides it, and states the rule behind it.
   */
  #verdictBlock(actor, target, state, reforged) {
    const explain = game.settings.get(MODULE_ID, "explain");
    const power = actor.system?.power?.value ?? 0;

    let headline = "Pick a target";
    let sums = "";
    let working = "";
    this.prediction = null;
    let rule =
      "The roller reads Defense, Soak and Poise from your target, so target a token before rolling.";

    if (target) {
      const n = targetNumbers(target, reforged);
      const { defense, poise, soak } = n;

      // Kept so a roll launched from this panel can be checked against what
      // the roller actually computed.
      this.prediction = { targetId: target.id, defense, poise };

      if (state === "standing") {
        headline = "Wither them";
        sums = `<b>${defense + poise}</b> successes Breaks them: ${defense} to beat Defense, then ${poise} more for their Poise.`;
        rule = "A target who still has Poise can only be hit by withering attacks. They Break when your extra successes reach their Poise.";
      } else if (state === "break") {
        headline = "Strike decisively";
        sums = `Damage is the Power you wager (you hold <b>${power}</b>) plus extra successes over ${defense} Defense, minus ${soak} Soak.`;
        rule = "In Break they can only be hit by decisive attacks, and their Poise cannot fall further until they rebuild it.";
      } else if (state === "group") {
        headline = "Strike decisively";
        sums = `${defense} Defense, ${soak} Soak. Forcing a rout check earns you Size + 1 Power.`;
        rule = "Battle groups have no Poise, so every attack on them is decisive. They cannot be withered outside a grapple.";
      } else {
        const hardness = target.system?.hardness?.value ?? 0;
        headline = "Your call";
        sums = `A decisive attack needs ${hardness} Power or more and you hold <b>${power}</b>. Defense ${defense}, Soak ${soak}.`;
        rule = "Standard rules: both attack types stay open, and a decisive attack needs Power at least equal to their Hardness.";
      }

      // Show the working, so a disagreement with the roller is visible rather
      // than just puzzling.
      const bits = [];
      if (n.working.length) {
        bits.push(`Defense ${n.baseDefense} &rarr; ${defense}: ${n.working.join(" &middot; ")}`);
      }
      bits.push(...n.notes);
      if (state !== "none") {
        bits.push("before they spend anything on defence");
      }
      working = bits.join(" &middot; ");
    }

    const notes = [];
    if (reforged && inBreak(actor)) {
      const poise = actor.system?.poise ?? { value: 0, max: 0 };
      const togo = Math.max(0, (poise.max ?? 0) - (poise.value ?? 0));
      notes.push(`You are in Break. Power you gain refills Poise first, ${togo} to go. Ask an ally to Defend Other.`);
    }
    if (reforged && state === "standing" && power > 0) {
      notes.push(`Your ${power} Power is waiting for the Break: withering attacks don't spend it.`);
    }
    if (reforged && state === "break" && power === 0) {
      notes.push("No Power to wager, but a decisive attack still lands on extra successes alone.");
    }

    return `
      <section class="epb-verdict" data-state="${state}">
        <p class="epb-headline">${headline}</p>
        ${sums ? `<p class="epb-sums">${sums}</p>` : ""}
        ${working ? `<p class="epb-working">${working}</p>` : ""}
        ${explain ? `<p class="epb-rule">${rule}</p>` : ""}
        ${notes.map((n) => `<p class="epb-prompt">${n}</p>`).join("")}
      </section>`;
  }

  #attackBlock(actor, allow, why, target, defense, reforged) {
    const weapons = equippedWeapons(actor);
    if (!weapons.length) {
      return `<section class="epb-attacks"><p class="epb-label">Attacks</p>
        <p class="epb-note">No equipped weapons on this sheet.</p></section>`;
    }

    const rows = weapons
      .map((weapon) => {
        const name = esc(weapon.name);
        const over = weapon.system?.overwhelming ?? 0;
        const open = this.openGambit === weapon.uuid;
        return `
        <div class="epb-weapon">
          <p class="epb-weapon-name">${name}
            <span class="epb-over">Overwhelming ${over}</span></p>
          <div class="epb-buttons">
            ${this.#attackButton(weapon, "withering", "Withering", allow, why)}
            ${this.#attackButton(weapon, "decisive", "Decisive", allow, why)}
            ${this.#gambitButton(weapon, open, allow, why)}
          </div>
          ${open ? this.#gambitList(weapon, target, defense, reforged) : ""}
        </div>`;
      })
      .join("");

    return `<section class="epb-attacks"><p class="epb-label">Attacks</p>${rows}</section>`;
  }

  /** Opens the list rather than the roller: the gambit is chosen first. */
  #gambitButton(weapon, open, allow, why) {
    const ok = allow.gambit;
    const reason = why.gambit ? esc(why.gambit) : "";
    return `
      <button type="button" class="epb-btn epb-gambit${open ? " epb-open" : ""}"
        data-action="gambitMenu" data-uuid="${weapon.uuid}"
        ${ok ? "" : "disabled"} ${reason ? `data-tooltip="${reason}"` : ""}>
        Gambit${ok ? (open ? " &#9652;" : " &#9662;") : ""}
      </button>`;
  }

  /**
   * The gambits for this weapon, priced. A gambit that cannot be used stays
   * listed with the reason, because "why can't I" is the question a hidden
   * row leaves unanswered.
   */
  #gambitList(weapon, target, defense, reforged) {
    const rows = GAMBITS
      .map((gambit) => priceGambit(gambit, weapon, target, defense, reforged))
      .map((row) => {
        if (row.blocked) {
          return `<li class="epb-gambit-row epb-blocked">
              <span class="epb-gambit-name">${row.name}</span>
              <span class="epb-gambit-why">${row.blocked}</span>
            </li>`;
        }
        const working = row.working ? `<span class="epb-muted">${row.working}</span>` : "";
        const note = row.note ? `<span class="epb-gambit-why">${row.note}</span>` : "";
        // Worth saying which side did the work, because on these rows it is
        // the panel rather than the system, and that is where to look if a
        // number or an effect ever looks wrong.
        let applies = "";
        if (row.unpriced) {
          applies = `<span class="epb-gambit-why">The system has neither a cost
            nor an effect for Grapple, so the panel supplies both the Power and
            the &minus;1 Defense you each take.</span>`;
        } else if (row.panelApplies) {
          applies = `<span class="epb-gambit-why">The system resolves this one
            to nothing, so the panel applies the Defense penalty itself.</span>`;
        }
        return `<li class="epb-gambit-row">
            <button type="button" class="epb-gambit-pick" data-action="gambit"
              data-uuid="${weapon.uuid}" data-gambit="${row.key}"
              data-power="${row.power}">
              <span class="epb-gambit-name">${row.name}</span>
              <span class="epb-cost">${row.power} Power ${working}</span>
            </button>
            <span class="epb-gambit-why">${row.effect}</span>
            ${note}${applies}
          </li>`;
      })
      .join("");

    return `<ul class="epb-gambits">${rows}</ul>`;
  }

  #attackButton(weapon, type, label, allow, why) {
    const ok = allow[type];
    const reason = why[type] ? esc(why[type]) : "";
    return `
      <button type="button" class="epb-btn epb-${type}"
        data-action="attack" data-attack="${type}" data-uuid="${weapon.uuid}"
        ${ok ? "" : "disabled"} ${reason ? `data-tooltip="${reason}"` : ""}>
        ${label}
      </button>`;
  }

  /**
   * Only shown to characters who know spells. Casting is not a roll type of
   * its own: you spend the spell's Will, and an attack spell is rolled as a
   * normal attack with Sagacity, so the same legality gate applies.
   */
  #sorceryBlock(actor, allow, why) {
    const spells = actor.items.filter((i) => i.type === "spell");
    // Shaping rituals alone are enough to show this: an initiate has Will to
    // focus before they have learned a single spell.
    const rituals = actor.items.filter((i) => i.type === "ritual");
    if (!spells.length && !rituals.length) return "";

    const will = actor.system?.will?.value ?? 0;
    const controlRule = game.settings.get(MODULE_ID, "controlSpells");
    // Being a control spell is a fact about this character, not about the
    // spell, which is why the system keeps the flag on their own copy and a
    // compendium spell can never carry it.
    const costOf = (spell) => {
      const printed = spell.system?.cost ?? 0;
      const control = controlRule && spell.system?.iscontrolspell;
      return { printed, cost: control ? Math.max(0, printed - 1) : printed,
               control };
    };

    const rows = spells
      .slice()
      .sort((a, b) => costOf(a).cost - costOf(b).cost)
      .map((spell) => {
        const { printed, cost, control } = costOf(spell);
        const afford = cost <= will;
        const price = control
          ? `<span class="epb-cost">${cost} Will <span class="epb-muted">(${printed} &minus; 1)</span></span>`
          : `<span class="epb-cost">${cost} Will</span>`;
        return `<li class="epb-spell${afford ? "" : " epb-unaffordable"}">
            <span>${esc(spell.name)}${control ? " &starf;" : ""}</span>
            ${price}
          </li>`;
      })
      .join("");

    const controlNote = controlRule && spells.some((s) => s.system?.iscontrolspell)
      ? " A control spell (&starf;) costs 1 less Will and may be improvised"
        + " with, as though it were a Charm."
      : "";

    return `
      <section class="epb-sorcery">
        <p class="epb-label">Sorcery</p>
        <div class="epb-stats">
          <span class="epb-stat"><b>${will}</b>/10 Will</span>
        </div>
        <ul class="epb-spells">${rows}</ul>
        <div class="epb-buttons">
          ${this.#castButton("withering", "Cast (withering)", allow, why)}
          ${this.#castButton("decisive", "Cast (decisive)", allow, why)}
          <button type="button" class="epb-btn" data-action="roll" data-roll-type="focusWill"
            data-tooltip="Attribute + Sagacity vs Difficulty 3. Gain 1 Will plus 1 per extra success. Cannot be flurried.">Focus Will</button>
        </div>
        <p class="epb-note">Casting drains Defense by 1 (first or second circle)
          or 2 (third), recovering 1 each turn. To reach a target who is not in
          Break, spend 1 Will per point of their Poise.${controlNote}</p>
      </section>`;
  }

  #castButton(type, label, allow, why) {
    const ok = allow[type];
    const reason = why[type] ? esc(why[type]) : "";
    return `
      <button type="button" class="epb-btn epb-${type}"
        data-action="roll" data-roll-type="${type}" data-ability="sagacity"
        ${ok ? "" : "disabled"} ${reason ? `data-tooltip="${reason}"` : ""}>
        ${label}
      </button>`;
  }

  #socialBlock(target) {
    const explain = game.settings.get(MODULE_ID, "explain");
    const button =
      `<button type="button" class="epb-btn" data-action="roll" ` +
      `data-roll-type="social">Social influence</button>`;

    if (!target) {
      return `
        <section class="epb-social">
          <p class="epb-label">Social influence</p>
          <p class="epb-working">Target a token to see the Resolve you need to beat.</p>
          <div class="epb-buttons">${button}</div>
        </section>`;
    }

    const { resolve, floor } = socialNumbers(target);
    const name = esc(target.name ?? "your target");
    const prompts = [
      "Appealing to an Intimacy or Virtue they hold lowers Resolve; arguing " +
        `against one raises it. It never falls below ${floor}.`,
      "Successes above their Resolve are what the influence buys."
    ];

    return `
      <section class="epb-social">
        <p class="epb-label">Social influence</p>
        <p class="epb-sums"><b>${resolve}</b> successes to move ${name}, before Intimacies and Virtues.</p>
        ${explain
          ? `<p class="epb-rule">Resolve is not touched by prone, surprise, grappling or wounds - those reduce Defense only. Influence is resisted the same whatever state they are in.</p>`
          : ""}
        ${prompts.map((p) => `<p class="epb-prompt">${p}</p>`).join("")}
        <div class="epb-buttons">${button}</div>
      </section>`;
  }

  #otherBlock() {
    return `
      <section class="epb-other">
        <p class="epb-label">Other rolls</p>
        <div class="epb-buttons">
          <button type="button" class="epb-btn" data-action="roll" data-roll-type="buildPower"
            data-tooltip="Attribute + Ability vs Difficulty 3. Cannot be flurried.">Build Power</button>
          <button type="button" class="epb-btn" data-action="roll" data-roll-type="base">Other</button>
        </div>
      </section>`;
  }

  #footer(reforged, target) {
    const rules = reforged
      ? "Combat Reforged is on."
      : "Standard rules — Combat Reforged is off, so both attack types stay available.";
    const targeted = target ? "" : " No target selected.";
    return `<footer class="epb-footer">${rules}${targeted}</footer>`;
  }
}

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
  });

  // Charm callouts: the roller paying for a roll's Charms, and the actor
  // spending one from the sheet.
  wrapRollerResources(game.exaltedessence?.RollForm);
  wrapSpendItem(CONFIG.Actor?.documentClass);

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
// in tests/ import it under a stubbed Foundry and need the pieces by name
// rather than prised out of the source text.
export {
  MODULE_ID, SYSTEM_ID, VERIFIED_SYSTEM,
  esc, legality, targetNumbers, socialNumbers,
  GAMBITS, grappleCost, priceGambit,
  SYSTEM_RESOLVES, PANEL_RESOLVES, grappleEffect, alreadyGrappling,
  resolveMissingGambits, afterActorSettles, grappleTheAttacker,
  TIMED_GAMBIT_EFFECTS, timedGambitEffect, gambitEffectOver, isResponsibleGM,
  stampGambitEffect, sweepGambitEffects, roundAdvanced,
  poiseShards, photosensitive, BREAK_COLORS, isBreakEffect, breakEffectTokens,
  seedFor, shardLayout, shatterFrame, mixColor, CRACK_LIGHT, shardColor,
  drawShatter, playBreakEffect, BREAK_TEXT_DURATION, breakTextFrame, breakTextSize,
  BREAK_TEXT_SIZE_MIN, BREAK_TEXT_SIZE_MAX,
  crackMask, createBreakText, quietCoreBreakText,
  CUT_IN_SOCKET, CUT_IN_MESSAGE, CUT_IN_DURATION, CUT_IN_DURATION_GENTLE,
  CUT_IN_CHARMS, CUT_IN_FALLBACK, CUT_IN_PORTRAIT,
  isDecisiveHit, cutInColor, cutInImage, cleanCutInPayload, cutInPayload,
  shouldShowCutIn, cutInCharms, cutInMarkup, playCutIn, wrapAttackSequence,
  receiveCutIn,
  FLARE_MESSAGE, FLARE_DURATION, FLARE_DURATION_GENTLE, FLARE_EMBERS,
  FLARE_EMBERS_GENTLE, FLARE_HEIGHT, FLARE_ICONIC_MAX,
  animaRank, crossesIntoFlare, iconicLine, flareLevelLabel, cleanFlarePayload,
  animaFlarePayload, changesAnima, recordAnimaBefore, animaAfterUpdate, flareToken,
  shouldShowFlare, flareFrame, emberLayout, drawFlare, flareCaptionMarkup,
  playAnimaFlare, playFlareCaption, playFlare, receiveAnimaFlare,
  ANIMA_TYPE_COLORS, ANIMA_CASTE_COLORS, ANIMA_WORD_COLORS, sheetAnimaColor, colorWords,
  closestColorWord, colorFromText, animaColorFor,
  FILL_LIST_MAX, animaColorPlan, animaColorUpdates, applyAnimaColors,
  animaColorPlanMarkup, AnimaColorFiller,
  breakTextStyle,
  CALLOUT_MESSAGE, CALLOUT_DURATION, CALLOUT_DURATION_GENTLE, CALLOUT_STAGGER, CALLOUT_MAX,
  CALLOUT_SIZE_MIN, CALLOUT_SIZE_MAX,
  calloutNames, calloutPayload, rollerCallout, sheetCallout, shouldShowCallouts,
  wrapRollerResources, wrapSpendItem, calloutFrame, calloutLines, calloutSize,
  calloutLayout, playCalloutsOnToken, playCallouts, receiveCallouts,
  TurnPanel
};
