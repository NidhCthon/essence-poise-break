/**
 * Poise & Break - Anima colours: matching one to each character, and the
 * Storyteller's button that writes them onto sheets.
 */

import { ApplicationV2, MODULE_ID } from "./core.js";
import { CUT_IN_FALLBACK, cutInColor } from "./cut-in.js";
import { esc } from "./rules.js";

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

/** Is this sheet still on the system's default white? */
function needsAnimaColor(actor) {
  return !!actor?.system?.details && !sheetAnimaColor(actor.system.details.animacolor);
}

/** Sidebar actors still on the default white, with the colour that fits each. */
function animaColorPlan(actors) {
  const list = actors ? [...actors] : [];
  return list.filter(needsAnimaColor).map((actor) => ({
    kind: "actor",
    id: actor.id ?? null,
    name: typeof actor.name === "string" ? actor.name : "",
    color: animaColorFor(actor)
  }));
}

/**
 * The same for unlinked tokens. Each keeps its own copy of the sheet inside
 * the scene, and that copy is the one its anima glow reads, so a token and the
 * actor it came from are two sheets and both are offered. A linked token uses
 * the sidebar actor, which the plan above already has.
 */
function tokenAnimaColorPlan(scenes) {
  const plan = [];
  for (const scene of scenes ? [...scenes] : []) {
    for (const token of scene?.tokens ? [...scene.tokens] : []) {
      const linked = token?.actorLink ?? token?.isLinked ?? false;
      const actor = token?.actor;
      if (linked || !needsAnimaColor(actor)) continue;
      plan.push({
        kind: "token",
        id: token.id ?? null,
        name: typeof token.name === "string" ? token.name : (actor.name ?? ""),
        scene: typeof scene.name === "string" ? scene.name : "",
        color: animaColorFor(actor),
        actor
      });
    }
  }
  return plan;
}

/** Everything the button would fill in: the sidebar first, then the scenes. */
function fullAnimaColorPlan(actors, scenes) {
  return [...animaColorPlan(actors), ...tokenAnimaColorPlan(scenes)];
}

/** The sidebar half of a plan, as Foundry document updates. */
function animaColorUpdates(plan) {
  return (plan ?? [])
    .filter((entry) => entry?.id && entry.kind !== "token")
    .map((entry) => ({ _id: entry.id, "system.details.animacolor": cutInColor(entry.color) }));
}

/**
 * Write the plan and report how many sheets were filled in. Sidebar actors go
 * in one update; a token's own copy is written through its own actor, which is
 * what puts the colour in that token rather than the one it came from.
 */
async function applyAnimaColors(plan, { update, updateActor } = {}) {
  const list = plan ?? [];
  const updates = animaColorUpdates(list);
  let filled = 0;
  if (updates.length) {
    const write = update
      ?? ((documents) => getDocumentClass("Actor").updateDocuments(documents));
    await write(updates);
    filled += updates.length;
  }
  const writeOne = updateActor ?? ((actor, data) => actor.update(data));
  for (const entry of list) {
    if (entry?.kind !== "token" || !entry.actor) continue;
    await writeOne(entry.actor, { "system.details.animacolor": cutInColor(entry.color) });
    filled += 1;
  }
  return filled;
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
    const where = entry.kind === "token"
      ? ` <span style="opacity:.7">token on ${esc(entry.scene)}</span>`
      : "";
    return `<li style="display:flex;align-items:center;gap:8px;padding:2px 0">
      <span style="width:16px;height:16px;border-radius:3px;flex:none;background:${color};
        box-shadow:0 0 6px ${color}"></span>
      <span style="flex:1">${esc(entry.name)}${where}</span>
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
    return fullAnimaColorPlan(game.actors ?? [], game.scenes ?? []);
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

export {
  ANIMA_ANY_CASTE_COLORS,
  ANIMA_CASTE_COLORS,
  ANIMA_TYPE_COLORS,
  ANIMA_WORD_COLORS,
  AnimaColorFiller,
  FILL_LIST_MAX,
  animaColorFor,
  animaColorPlan,
  animaColorPlanMarkup,
  animaColorUpdates,
  applyAnimaColors,
  closestColorWord,
  colorFromText,
  colorWords,
  fullAnimaColorPlan,
  needsAnimaColor,
  oneEditApart,
  sheetAnimaColor,
  tokenAnimaColorPlan
};
