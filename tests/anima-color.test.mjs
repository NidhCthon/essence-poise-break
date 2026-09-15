// Anima colours: a colour picked on the sheet wins, and with the default white
// one is found from the caste, a Liminal's nature, the anima descriptions or
// the Exalt type - and the cut-in, flare and callouts all use it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel } from "./foundry.mjs";

const {
  animaColorFor, closestColorWord, colorFromText, sheetAnimaColor,
  ANIMA_TYPE_COLORS, ANIMA_CASTE_COLORS, ANIMA_WORD_COLORS,
  CUT_IN_FALLBACK, cutInColor, cutInPayload, animaFlarePayload, calloutPayload
} = panel;

const scene = { id: "scene" };

function character({
  exalt = "other", caste = "", nature = "", animacolor = "#FFFFFF", anima = {}
} = {}) {
  return {
    uuid: "Actor.hero", name: "Rising Tide", img: "hero.webp", hasPlayerOwner: true,
    system: { details: { exalt, caste, nature, animacolor }, anima },
    token: null,
    getActiveTokens: () => [{ document: { id: "tok", parent: scene } }]
  };
}

const colorOf = (options) => animaColorFor(character(options));

/* ------------------------------ the order ------------------------------ */

test("a colour picked on the sheet always wins", () => {
  assert.equal(colorOf({ exalt: "dragonblooded", caste: "Fire Aspect", animacolor: "#2e8bff" }), "#2E8BFF");
  assert.equal(colorOf({ exalt: "solar", animacolor: CUT_IN_FALLBACK }), CUT_IN_FALLBACK,
    "even a colour that happens to be the fallback");
});

test("the system's default white counts as no colour picked", () => {
  assert.equal(sheetAnimaColor("#FFFFFF"), null);
  assert.equal(sheetAnimaColor("#F4F4F4"), null);
  assert.equal(sheetAnimaColor("nonsense"), null);
  assert.equal(colorOf({ exalt: "dragonblooded", caste: "Wood Aspect" }), ANIMA_CASTE_COLORS.dragonblooded.wood);
});

test("every Dragon-Blooded aspect takes its element's colour", () => {
  for (const [aspect, color] of Object.entries(ANIMA_CASTE_COLORS.dragonblooded)) {
    assert.equal(colorOf({ exalt: "dragonblooded", caste: `${aspect} Aspect` }), color, aspect);
  }
  assert.notEqual(ANIMA_CASTE_COLORS.dragonblooded.wood, ANIMA_CASTE_COLORS.dragonblooded.fire);
});

test("Solar castes each have their own colour, typed any way", () => {
  assert.equal(colorOf({ exalt: "solar", caste: "Night Caste" }), ANIMA_CASTE_COLORS.solar.night);
  assert.equal(colorOf({ exalt: "solar", caste: "dawn" }), ANIMA_CASTE_COLORS.solar.dawn);
  assert.equal(colorOf({ exalt: "solar", caste: "ZENITH" }), ANIMA_CASTE_COLORS.solar.zenith);
});

test("a caste typed loosely still finds its colour", () => {
  assert.equal(colorOf({ exalt: "sidereal", caste: "Chosen of Jorneys" }), ANIMA_CASTE_COLORS.sidereal.journeys);
  assert.equal(colorOf({ exalt: "sidereal", caste: "the Secret caste" }), ANIMA_CASTE_COLORS.sidereal.secrets);
  assert.equal(colorOf({ exalt: "dragonblooded", caste: "Wood-aspected" }), ANIMA_CASTE_COLORS.dragonblooded.wood);
});

test("a two-word caste is read as one: No Moon is not the silver of 'moon'", () => {
  assert.equal(colorOf({ exalt: "lunar", caste: "No Moon Caste" }), ANIMA_CASTE_COLORS.lunar["no moon"]);
  assert.equal(colorOf({ exalt: "lunar", caste: "Full Moon" }), ANIMA_CASTE_COLORS.lunar.full);
});

test("a caste that belongs to another Exalt type still counts", () => {
  assert.equal(colorOf({ exalt: "other", caste: "Journeys" }), ANIMA_CASTE_COLORS.sidereal.journeys);
});

test("a caste written as a colour word finds that colour", () => {
  assert.equal(colorOf({ exalt: "exigent", caste: "Crimson Oath" }), ANIMA_WORD_COLORS.crimson);
});

test("a Liminal's nature gives the colour when the caste says nothing", () => {
  assert.equal(colorOf({ exalt: "liminal", nature: "soil" }), ANIMA_CASTE_COLORS.liminal.soil);
});

test("colour words in the anima descriptions come before the Exalt type", () => {
  assert.equal(colorOf({ exalt: "solar", anima: { iconic: "A burning phoenix unfolds its wings." } }),
    ANIMA_WORD_COLORS.burning);
  assert.equal(colorOf({ exalt: "abyssal", anima: { passive: "<p>Pale moonlit mist</p>" } }),
    ANIMA_WORD_COLORS.moon, "moonlit is moon, through markup");
});

test("the Exalt type is the last word, and every type has a colour", () => {
  for (const [type, color] of Object.entries(ANIMA_TYPE_COLORS)) {
    assert.equal(colorOf({ exalt: type }), color, type);
  }
});

test("with nothing to go on, orichalcum", () => {
  assert.equal(colorOf({ exalt: "other" }), CUT_IN_FALLBACK);
  assert.equal(animaColorFor(null), CUT_IN_FALLBACK);
});

/* --------------------------- loose matching --------------------------- */

test("endings and near misses match; short keywords only match exactly", () => {
  assert.equal(closestColorWord("flames", ANIMA_WORD_COLORS), ANIMA_WORD_COLORS.flame);
  assert.equal(closestColorWord("embers", ANIMA_WORD_COLORS), ANIMA_WORD_COLORS.ember);
  assert.equal(closestColorWord("emarald", ANIMA_WORD_COLORS), ANIMA_WORD_COLORS.emerald);
  assert.equal(closestColorWord("season", ANIMA_WORD_COLORS), null, "not sea");
  assert.equal(closestColorWord("redeemer", ANIMA_WORD_COLORS), null, "not red");
  assert.equal(closestColorWord("aspect", ANIMA_WORD_COLORS), null);
  assert.equal(colorFromText("", ANIMA_WORD_COLORS), null);
  assert.equal(colorFromText(undefined, ANIMA_WORD_COLORS), null);
});

test("the earliest colour word in the text wins", () => {
  assert.equal(colorFromText("jade flames over the sea", ANIMA_WORD_COLORS), ANIMA_WORD_COLORS.jade);
});

/* ------------------------------ the tables ------------------------------ */

test("every colour is a clean hex that will not be taken for white", () => {
  const all = [
    ...Object.values(ANIMA_TYPE_COLORS),
    ...Object.values(ANIMA_CASTE_COLORS).flatMap((castes) => Object.values(castes)),
    ...Object.values(ANIMA_WORD_COLORS)
  ];
  for (const color of all) {
    assert.match(color, /^#[0-9A-F]{6}$/, color);
    assert.equal(cutInColor(color), color, `${color} would be replaced as near-white`);
  }
});

/* ------------------------------ the effects ------------------------------ */

test("the cut-in, flare and callouts all take the colour found", () => {
  const green = ANIMA_CASTE_COLORS.dragonblooded.wood;
  const actor = character({ exalt: "dragonblooded", caste: "Wood Aspect" });

  const cutIn = cutInPayload({
    actor,
    object: { rollType: "decisive", accuracyResult: 5, defense: 2, addedCharms: [] },
    _getActorToken: () => ({ document: { id: "tok", parent: scene } })
  });
  assert.equal(cutIn.color, green);

  actor.system.anima.level = "bonfire";
  assert.equal(animaFlarePayload(actor).color, green);

  assert.equal(calloutPayload(actor, { document: { id: "tok", parent: scene } }, ["X"]).color, green);
});
