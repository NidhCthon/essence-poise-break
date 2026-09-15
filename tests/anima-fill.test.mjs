// The Storyteller's button that writes matched anima colours onto sheets:
// which sheets it would touch, what it writes, and that it writes nothing on
// its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, menus, fireOnce } from "./foundry.mjs";

const {
  animaColorPlan, animaColorUpdates, applyAnimaColors, animaColorPlanMarkup,
  animaColorFor, FILL_LIST_MAX, ANIMA_CASTE_COLORS, ANIMA_TYPE_COLORS, AnimaColorFiller
} = panel;

function sheet({ id = "a1", name = "Rising Tide", exalt = "solar", caste = "", animacolor = "#FFFFFF" } = {}) {
  return { id, name, system: { details: { exalt, caste, animacolor }, anima: {} } };
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
