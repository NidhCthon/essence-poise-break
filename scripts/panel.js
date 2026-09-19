/**
 * Poise & Break - The turn panel itself.
 */

import { ApplicationV2, MODULE_ID, SYSTEM_ID, VERIFIED_SYSTEM } from "./core.js";
import { GAMBITS, currentTarget, equippedWeapons, esc, inBreak, legality, priceGambit, socialNumbers, targetNumbers, usingReforged } from "./rules.js";
import { photosensitive, poiseShards } from "./break-effect.js";
import { resolveMissingGambits } from "./gambits.js";

/* -------------------------------------------- */
/*  The panel                                   */
/* -------------------------------------------- */

/** Only nag once per session; the console keeps the full record. */
let driftWarned = false;

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
          + "Fix targetNumbers() in scripts/rules.js."
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

export {
  TurnPanel,
  driftWarned
};
