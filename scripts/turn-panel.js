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

  try {
    draw();
    await CanvasAnimation.animate(
      [{ parent: state, attribute: "t", from: 0, to: 1 }],
      {
        name: `${MODULE_ID}.break.${token.id}`,
        context: container,
        duration: gentle ? 1600 : BREAK_DURATION,
        ontick: draw
      }
    );
  } catch (err) {
    console.error(`${MODULE_ID} | could not play the Break effect`, err);
  } finally {
    if (!container.destroyed) container.destroy({ children: true });
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
    hint: "Plays a shatter on a token the moment it Breaks. With Foundry's "
      + "photosensitive mode on, it is a slow, faint ring instead. Turn this "
      + "off to hide it.",
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
  drawShatter, playBreakEffect,
  TurnPanel
};
