// The Storyteller's button that writes matched anima colours onto sheets:
// which sheets it would touch, what it writes, and that it writes nothing on
// its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, menus, fireOnce } from "./foundry.mjs";

const {
  animaColorPlan, tokenAnimaColorPlan, fullAnimaColorPlan, animaColorUpdates,
  applyAnimaColors, animaColorPlanMarkup, animaColorFor, FILL_LIST_MAX,
  ANIMA_CASTE_COLORS, ANIMA_TYPE_COLORS, AnimaColorFiller
} = panel;

function sheet({ id = "a1", name = "Rising Tide", exalt = "solar", caste = "", animacolor = "#FFFFFF" } = {}) {
  return { id, name, system: { details: { exalt, caste, animacolor }, anima: {} } };
}

/** A scene of tokens, each with its own copy of a sheet unless it is linked. */
function scene({ name = "Tomb of Memory", tokens = [] } = {}) {
  return { id: "s1", name, tokens };
}

function token({ id = "t1", name = "Grave Hound", linked = false, actor = sheet({ id: "inner" }) } = {}) {
  return { id, name, actorLink: linked, actor };
}

/* -------------------------------- the plan -------------------------------- */

test("only sheets still on the system's default white are listed", () => {
  const plan = animaColorPlan([
    sheet({ id: "white" }),
    sheet({ id: "picked", animacolor: "#2E8BFF" }),
    sheet({ id: "blank", animacolor: "" }),
    { id: "no-details", name: "Prop", system: {} }
  ]);
  assert.deepEqual(plan.map((entry) => entry.id), ["white", "blank"]);
});

test("each listed sheet gets the colour matched for that character", () => {
  const [entry] = animaColorPlan([sheet({ exalt: "dragonblooded", caste: "Wood Aspect" })]);
  assert.equal(entry.color, ANIMA_CASTE_COLORS.dragonblooded.wood);
  assert.equal(entry.color, animaColorFor(sheet({ exalt: "dragonblooded", caste: "Wood Aspect" })));
  assert.equal(entry.name, "Rising Tide");
});

test("any collection of actors will do, and none at all is no plan", () => {
  assert.equal(animaColorPlan(new Set([sheet()])).length, 1);
  assert.deepEqual(animaColorPlan([]), []);
  assert.deepEqual(animaColorPlan(undefined), []);
});

/* --------------------------- unlinked tokens --------------------------- */

test("an unlinked token's own copy of the sheet is listed, with its scene", () => {
  const plan = tokenAnimaColorPlan([scene({ tokens: [token()] })]);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, "token");
  assert.equal(plan[0].name, "Grave Hound");
  assert.equal(plan[0].scene, "Tomb of Memory");
  assert.equal(plan[0].color, ANIMA_TYPE_COLORS.solar);
  assert.ok(plan[0].actor, "the token's own actor is kept, to write through");
});

test("linked tokens and tokens with a colour picked are left out", () => {
  const plan = tokenAnimaColorPlan([scene({ tokens: [
    token({ id: "linked", linked: true }),
    token({ id: "picked", actor: sheet({ animacolor: "#2E8BFF" }) }),
    token({ id: "no-actor", actor: null }),
    token({ id: "fill-me" })
  ] })]);
  assert.deepEqual(plan.map((entry) => entry.id), ["fill-me"]);
});

test("no scenes, or a scene with no tokens, is no plan", () => {
  assert.deepEqual(tokenAnimaColorPlan([]), []);
  assert.deepEqual(tokenAnimaColorPlan(undefined), []);
  assert.deepEqual(tokenAnimaColorPlan([scene()]), []);
});

test("the sidebar comes first, then the scenes", () => {
  const plan = fullAnimaColorPlan([sheet({ id: "a1" })], [scene({ tokens: [token({ id: "t1" })] })]);
  assert.deepEqual(plan.map((entry) => [entry.kind, entry.id]), [["actor", "a1"], ["token", "t1"]]);
});

/* ------------------------------- the writing ------------------------------ */

test("the plan becomes one update per sheet, against the anima colour field", () => {
  const updates = animaColorUpdates(animaColorPlan([sheet({ id: "a1", exalt: "infernal" })]));
  assert.deepEqual(updates, [{ _id: "a1", "system.details.animacolor": ANIMA_TYPE_COLORS.infernal }]);
  assert.deepEqual(animaColorUpdates([{ name: "no id", color: "#2E8BFF" }]), [], "a sheet with no id is skipped");
});

test("applying writes every sheet in one go and reports how many", async () => {
  const written = [];
  const plan = animaColorPlan([sheet({ id: "a1" }), sheet({ id: "a2", exalt: "lunar" })]);
  const filled = await applyAnimaColors(plan, { update: (documents) => written.push(documents) });
  assert.equal(filled, 2);
  assert.equal(written.length, 1, "one call, not one per sheet");
  assert.deepEqual(written[0].map((u) => u._id), ["a1", "a2"]);
});

test("with nothing to fill in, nothing is written", async () => {
  const written = [];
  assert.equal(await applyAnimaColors([], { update: (d) => written.push(d) }), 0);
  assert.equal(written.length, 0);
});

test("a token's copy is written through its own actor, not with the sidebar", async () => {
  const bulk = [];
  const each = [];
  const plan = fullAnimaColorPlan(
    [sheet({ id: "a1", exalt: "lunar" })],
    [scene({ tokens: [token({ id: "t1", actor: sheet({ id: "inner", exalt: "infernal" }) })] })]
  );
  const filled = await applyAnimaColors(plan, {
    update: (documents) => bulk.push(documents),
    updateActor: (actor, data) => each.push([actor, data])
  });
  assert.equal(filled, 2);
  assert.deepEqual(bulk[0].map((u) => u._id), ["a1"], "only the sidebar actor is written in bulk");
  assert.equal(each.length, 1);
  assert.deepEqual(each[0][1], { "system.details.animacolor": ANIMA_TYPE_COLORS.infernal });
  assert.equal(each[0][0].id, "inner", "written through the token's own actor");
});

test("tokens alone need no bulk update at all", async () => {
  const bulk = [];
  const each = [];
  const plan = fullAnimaColorPlan([], [scene({ tokens: [token()] })]);
  assert.equal(await applyAnimaColors(plan, {
    update: (d) => bulk.push(d), updateActor: (a, data) => each.push(data)
  }), 1);
  assert.equal(bulk.length, 0);
  assert.equal(each.length, 1);
});

/* ------------------------------- the window ------------------------------- */

test("the window lists each sheet with its colour, and escapes names", () => {
  const html = animaColorPlanMarkup(animaColorPlan([
    { id: "x", name: "<img src=x onerror=alert(1)>", system: { details: { exalt: "solar", animacolor: "#FFFFFF" }, anima: {} } }
  ]));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes(ANIMA_TYPE_COLORS.solar));
  assert.ok(html.includes("1 sheet is still"));
});

test("a long list is cut short, and the rest counted", () => {
  const many = Array.from({ length: FILL_LIST_MAX + 7 }, (_, i) => sheet({ id: `a${i}` }));
  const html = animaColorPlanMarkup(animaColorPlan(many));
  assert.equal((html.match(/<li/g) ?? []).length, FILL_LIST_MAX);
  assert.ok(html.includes("and 7 more"));
  assert.ok(html.includes(`${FILL_LIST_MAX + 7} sheets are still`));
});

test("a token's row says which scene it is on", () => {
  const html = animaColorPlanMarkup(tokenAnimaColorPlan([scene({ tokens: [token()] })]));
  assert.ok(html.includes("Grave Hound"));
  assert.ok(html.includes("token on Tomb of Memory"));
});

test("with nothing to do it says so", () => {
  assert.ok(animaColorPlanMarkup([]).includes("nothing to fill in"));
});

/* ------------------------------- the button ------------------------------- */

test("the button is registered for the Storyteller alone, and opens the window", async () => {
  await fireOnce("init");
  const menu = menus.find((entry) => entry.key === "fillAnimaColors");
  assert.ok(menu, "no settings button was registered");
  assert.equal(menu.module, "essence-poise-break");
  assert.equal(menu.options.restricted, true, "any player could rewrite every sheet");
  assert.equal(menu.options.type, AnimaColorFiller);
  assert.ok(menu.options.name && menu.options.label && menu.options.hint);
});
