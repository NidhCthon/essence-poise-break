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
  why.gambit = why.decisive;
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

/* -------------------------------------------- */
/*  The panel                                   */
/* -------------------------------------------- */

class TurnPanel extends ApplicationV2 {
  constructor(actor, options = {}) {
    super(options);
    this.actor = actor;
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
    setTimeout(() => {
      try {
        const rolled = game.rollForm?.object;
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
    game.rollForm = new RollForm(
      this.actor,
      { classes: [" exaltedessence exaltedessence-dialog dice-roller"] },
      {},
      data
    ).render(true);
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

    return [
      this.#selfBlock(actor, reforged),
      this.#targetBlock(target, state, reforged),
      this.#verdictBlock(actor, target, state, reforged),
      this.#attackBlock(actor, allow, why),
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

    const guard = reforged
      ? `<span class="epb-stat"><b>${poise.value}</b>/${poise.max} Poise</span>`
      : `<span class="epb-stat"><b>${hardness}</b> Hardness</span>`;

    const brokenNote =
      reforged && broken
        ? `<p class="epb-note epb-break">You are in Break. Power you gain refills Poise
             first — ${Math.max(0, (poise.max ?? 0) - (poise.value ?? 0))} to go.
             Only decisive attacks can target you.</p>`
        : "";

    return `
      <section class="epb-self">
        <h3>${esc(actor.name)}</h3>
        <div class="epb-stats">
          <span class="epb-stat"><b>${power.value}</b>/${power.max ?? 10} Power</span>
          ${guard}
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
        `Standing · ${target.system?.poise?.value ?? 0} Poise`,
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

    return `
      <section class="epb-target">
        <p class="epb-label">Target</p>
        <p class="epb-target-name">${esc(target.name)}</p>
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

  #attackBlock(actor, allow, why) {
    const weapons = equippedWeapons(actor);
    if (!weapons.length) {
      return `<section class="epb-attacks"><p class="epb-label">Attacks</p>
        <p class="epb-note">No equipped weapons on this sheet.</p></section>`;
    }

    const rows = weapons
      .map((weapon) => {
        const name = esc(weapon.name);
        const over = weapon.system?.overwhelming ?? 0;
        return `
        <div class="epb-weapon">
          <p class="epb-weapon-name">${name}
            <span class="epb-over">Overwhelming ${over}</span></p>
          <div class="epb-buttons">
            ${this.#attackButton(weapon, "withering", "Withering", allow, why)}
            ${this.#attackButton(weapon, "decisive", "Decisive", allow, why)}
            ${this.#attackButton(weapon, "gambit", "Gambit", allow, why)}
          </div>
        </div>`;
      })
      .join("");

    return `<section class="epb-attacks"><p class="epb-label">Attacks</p>${rows}</section>`;
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
    const rows = spells
      .slice()
      .sort((a, b) => (a.system?.cost ?? 0) - (b.system?.cost ?? 0))
      .map((spell) => {
        const cost = spell.system?.cost ?? 0;
        const afford = cost <= will;
        return `<li class="epb-spell${afford ? "" : " epb-unaffordable"}">
            <span>${esc(spell.name)}</span>
            <span class="epb-cost">${cost} Will</span>
          </li>`;
      })
      .join("");

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
          Break, spend 1 Will per point of their Poise.</p>
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
