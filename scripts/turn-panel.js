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
  }

  static async #onRoll(event, element) {
    const rollType = element.dataset.rollType;
    const RollForm = game.exaltedessence?.RollForm;
    if (!RollForm) {
      ui.notifications.error("Exalted Essence's roller API was not found.");
      return;
    }
    game.rollForm = new RollForm(
      this.actor,
      { classes: [" exaltedessence exaltedessence-dialog dice-roller"] },
      {},
      { rollType }
    ).render(true);
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
      this.#attackBlock(actor, allow, why),
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

  #otherBlock() {
    return `
      <section class="epb-other">
        <p class="epb-label">Other rolls</p>
        <div class="epb-buttons">
          <button type="button" class="epb-btn" data-action="roll" data-roll-type="buildPower"
            data-tooltip="Attribute + Ability vs Difficulty 3. Cannot be flurried.">Build Power</button>
          <button type="button" class="epb-btn" data-action="roll" data-roll-type="focusWill">Focus Will</button>
          <button type="button" class="epb-btn" data-action="roll" data-roll-type="social">Social</button>
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
  Hooks.on("updateItem", refreshPanel);
});
