/**
 * Poise & Break - Gambits the system leaves unfinished, and clearing the effects
 * gambits leave behind once they are over.
 */

import { MODULE_ID, SYSTEM_ID } from "./core.js";

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

export {
  PANEL_RESOLVES,
  SYSTEM_RESOLVES,
  TIMED_GAMBIT_EFFECTS,
  afterActorSettles,
  alreadyGrappling,
  clearingGambitEffects,
  defenceChanges,
  gambitEffectOver,
  grappleEffect,
  grappleTheAttacker,
  isResponsibleGM,
  resolveMissingGambits,
  roundAdvanced,
  stampGambitEffect,
  sweepGambitEffects,
  timedGambitEffect
};
