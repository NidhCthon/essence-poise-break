// The decisive cut-in: when it plays, who sees it, what it shows, and that
// wrapping the system's roller can never break a roll.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings } from "./foundry.mjs";

const {
  isDecisiveHit, cutInColor, cutInImage, cleanCutInPayload, cutInPayload,
  shouldShowCutIn, cutInCharms, cutInMarkup, wrapAttackSequence, receiveCutIn,
  CUT_IN_CHARMS, CUT_IN_FALLBACK, CUT_IN_PORTRAIT, CUT_IN_MESSAGE
} = panel;

const scene = { id: "scene" };
const player = { id: "player", isGM: false };
const storyteller = { id: "gm", isGM: true };

/** A roller at the end of its damage roll, as attackSequence() finds it. */
function roller({
  rollType = "decisive", accuracy = 6, defense = 4, charms = [],
  owner = true, color = "#2E8BFF", token = { document: { id: "tok", parent: scene } }
} = {}) {
  return {
    object: {
      rollType, accuracyResult: accuracy, defense,
      addedCharms: charms.map((name) => ({ name }))
    },
    actor: {
      uuid: "Actor.hero", name: "Rising Tide", img: "portraits/hero.webp",
      hasPlayerOwner: owner, system: { details: { animacolor: color } }
    },
    _getActorToken: () => token
  };
}

/* ------------------------------ the roll ------------------------------ */

test("a decisive attack that meets Defense hits; one short of it misses", () => {
  assert.equal(isDecisiveHit({ rollType: "decisive", accuracyResult: 5, defense: 3 }), true);
  assert.equal(isDecisiveHit({ rollType: "decisive", accuracyResult: 3, defense: 3 }), true);
  assert.equal(isDecisiveHit({ rollType: "decisive", accuracyResult: 2, defense: 3 }), false);
});

test("only decisive attacks count, and a roll with no numbers is not a hit", () => {
  for (const rollType of ["withering", "gambit", "social", "base"]) {
    assert.equal(isDecisiveHit({ rollType, accuracyResult: 9, defense: 1 }), false, rollType);
  }
  assert.equal(isDecisiveHit({ rollType: "decisive" }), false);
  assert.equal(isDecisiveHit(null), false);
});

test("a decisive hit becomes a payload carrying the Charms added to the roll", () => {
  const payload = cutInPayload(roller({
    charms: [" Tidebreaker Blade ", "Undertow Grip", "Tidebreaker Blade", ""]
  }));
  assert.deepEqual(payload, {
    actorUuid: "Actor.hero", tokenId: "tok", sceneId: "scene", name: "Rising Tide",
    img: "portraits/hero.webp", color: "#2E8BFF",
    charms: ["Tidebreaker Blade", "Undertow Grip"], storyteller: false
  });
});

test("a miss, any other attack, or a roller with no actor makes no payload", () => {
  assert.equal(cutInPayload(roller({ accuracy: 1, defense: 4 })), null);
  assert.equal(cutInPayload(roller({ rollType: "withering" })), null);
  assert.equal(cutInPayload({ object: { rollType: "decisive", accuracyResult: 5, defense: 1 } }), null);
});

test("the token is found whether the roller hands back a token or its document", () => {
  assert.equal(cutInPayload(roller({ token: { document: { id: "tok", parent: scene } } })).tokenId, "tok");
  assert.equal(cutInPayload(roller({ token: { id: "tok", parent: scene } })).tokenId, "tok");
  const tokenless = cutInPayload(roller({ token: null }));
  assert.equal(tokenless.tokenId, null);
  assert.equal(tokenless.sceneId, null);
});

/* ---------------------------- what it shows ---------------------------- */

test("the band takes the anima colour; white or nonsense falls back to orichalcum", () => {
  assert.equal(cutInColor("#2e8bff"), "#2E8BFF");
  assert.equal(cutInColor("2e8bff"), "#2E8BFF");
  assert.equal(cutInColor("#FFFFFF"), CUT_IN_FALLBACK, "the system's default anima colour");
  assert.equal(cutInColor("#F0F0F0"), CUT_IN_FALLBACK);
  for (const bad of [undefined, "", "red", "#12345", "#1234567", "url(x)"]) {
    assert.equal(cutInColor(bad), CUT_IN_FALLBACK, String(bad));
  }
});

test("a portrait path that could run script is replaced with the silhouette", () => {
  assert.equal(cutInImage("portraits/hero.webp"), "portraits/hero.webp");
  assert.equal(cutInImage("data:image/svg+xml,<svg/>"), "data:image/svg+xml,<svg/>");
  for (const bad of [" javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "", 5]) {
    assert.equal(cutInImage(bad), CUT_IN_PORTRAIT, String(bad));
  }
});

test("names and Charms are escaped, never trusted as markup", () => {
  const html = cutInMarkup(
    { name: `<img src=x onerror="alert(1)">`, img: "a.webp", color: "#2E8BFF" },
    { charms: ["<script>bad()</script>"] }
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("the colour reaches the style only as a clean hex value", () => {
  const html = cutInMarkup({ name: "X", img: "a.webp", color: "red; background:url(x)" });
  assert.ok(html.includes(`--epb-cutin-color: ${CUT_IN_FALLBACK}`));
  assert.ok(!html.includes("url(x)"));
});

test("a long list names the first few Charms and counts the rest", () => {
  const charms = ["One", "Two", "Three", "Four", "Five"];
  const html = cutInMarkup({ name: "Rising Tide", img: "a.webp", color: "#2E8BFF" }, { charms });
  assert.equal((html.match(/<li>/g) ?? []).length, CUT_IN_CHARMS);
  assert.ok(html.includes(`+${charms.length - CUT_IN_CHARMS} more`));
});

test("with no Charms to name there is no list at all", () => {
  const html = cutInMarkup({ name: "Rising Tide", img: "a.webp", color: "#2E8BFF" }, { charms: [] });
  assert.ok(!html.includes("epb-cutin-charms"));
});

test("the gentle version is marked for the stylesheet", () => {
  const base = { name: "X", img: "a.webp", color: "#2E8BFF" };
  assert.ok(cutInMarkup(base, { gentle: true }).includes(`data-gentle="true"`));
  assert.ok(!cutInMarkup(base).includes("data-gentle"));
});

/* ----------------------------- who sees what ---------------------------- */

test("a player's Charms are named for everyone", () => {
  const payload = cutInPayload(roller({ charms: ["Tidebreaker Blade"] }));
  assert.deepEqual(cutInCharms(payload, player), ["Tidebreaker Blade"]);
});

test("an antagonist's Charms stay with the Storyteller unless the table names them", () => {
  const payload = cutInPayload(roller({ owner: false, charms: ["Hungry Tide Maw"] }));
  assert.equal(payload.storyteller, true);
  assert.deepEqual(cutInCharms(payload, player), []);
  assert.deepEqual(cutInCharms(payload, storyteller), ["Hungry Tide Maw"]);
  settings.set("essence-poise-break.revealStorytellerCharms", true);
  try {
    assert.deepEqual(cutInCharms(payload, player), ["Hungry Tide Maw"]);
  } finally {
    settings.set("essence-poise-break.revealStorytellerCharms", false);
  }
});

test("who owns the attacker is read from the actor, not taken from the message", () => {
  const claimed = { ...cutInPayload(roller({ owner: false, charms: ["Hungry Tide Maw"] })), storyteller: false };
  assert.deepEqual(cutInCharms(claimed, player, { hasPlayerOwner: false }), []);
});

function viewing({ sceneId = "scene", tokens = {} } = {}) {
  globalThis.canvas = { scene: { id: sceneId }, tokens: { get: (id) => tokens[id] } };
}

test("it plays for an attacker whose token this player can see", () => {
  viewing({ tokens: { tok: { isVisible: true } } });
  assert.equal(shouldShowCutIn(cutInPayload(roller()), player), true);
});

test("an attacker hidden from this player gives nothing away", () => {
  viewing({ tokens: { tok: { isVisible: false } } });
  assert.equal(shouldShowCutIn(cutInPayload(roller()), player), false);
});

test("off the map a player is viewing, only the attacker's owners and the Storyteller see it", () => {
  viewing({ sceneId: "elsewhere" });
  globalThis.fromUuidSync = () => ({ isOwner: false });
  try {
    assert.equal(shouldShowCutIn(cutInPayload(roller()), player), false);
    assert.equal(shouldShowCutIn(cutInPayload(roller()), storyteller), true);
    globalThis.fromUuidSync = () => ({ isOwner: true });
    assert.equal(shouldShowCutIn(cutInPayload(roller()), player), true);
  } finally {
    delete globalThis.fromUuidSync;
  }
});

test("a player who turned it off sees none", () => {
  viewing({ tokens: { tok: { isVisible: true } } });
  settings.set("essence-poise-break.decisiveCutIn", false);
  try {
    assert.equal(shouldShowCutIn(cutInPayload(roller()), player), false);
  } finally {
    settings.set("essence-poise-break.decisiveCutIn", true);
  }
});

/* ------------------------------ the roller ------------------------------ */

function fakeRollForm(step = () => "animated") {
  class RollForm {}
  RollForm.prototype.attackSequence = step;
  return RollForm;
}

const quietly = (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = warn; }
};

test("the roller's own attack step runs first, and its result passes through", () => {
  const order = [];
  const RollForm = fakeRollForm(function () { order.push("system"); return "animated"; });
  wrapAttackSequence(RollForm, {
    emit: () => order.push("send"), play: () => order.push("play"), show: () => true
  });
  const form = Object.assign(new RollForm(), roller());
  assert.equal(form.attackSequence(), "animated");
  assert.deepEqual(order, ["system", "send", "play"]);
});

test("a decisive hit is sent to everyone; a miss or any other attack sends nothing", () => {
  const sent = [];
  const RollForm = fakeRollForm(() => undefined);
  wrapAttackSequence(RollForm, { emit: (message) => sent.push(message), play: () => {}, show: () => false });
  Object.assign(new RollForm(), roller({ charms: ["Tidebreaker Blade"] })).attackSequence();
  Object.assign(new RollForm(), roller({ rollType: "withering" })).attackSequence();
  Object.assign(new RollForm(), roller({ accuracy: 0 })).attackSequence();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, CUT_IN_MESSAGE);
  assert.deepEqual(sent[0].payload.charms, ["Tidebreaker Blade"]);
});

test("it is sent even when this player has the cut-in switched off", () => {
  const sent = [];
  const played = [];
  const RollForm = fakeRollForm();
  wrapAttackSequence(RollForm, {
    emit: (message) => sent.push(message), play: (p) => played.push(p), show: () => false
  });
  Object.assign(new RollForm(), roller()).attackSequence();
  assert.equal(sent.length, 1);
  assert.equal(played.length, 0);
});

test("a failure anywhere in the cut-in can never break the roll", () => {
  const played = [];
  const RollForm = fakeRollForm(() => "animated");
  wrapAttackSequence(RollForm, {
    emit: () => { throw new Error("socket down"); },
    play: (p) => played.push(p),
    show: () => true
  });
  const form = Object.assign(new RollForm(), roller());
  assert.equal(quietly(() => form.attackSequence()), "animated");
  assert.equal(played.length, 1, "a failed send still plays here");

  const Broken = fakeRollForm(() => "animated");
  wrapAttackSequence(Broken, { emit: () => {}, play: () => { throw new Error("no DOM"); }, show: () => true });
  assert.equal(quietly(() => Object.assign(new Broken(), roller()).attackSequence()), "animated");

  const Unreadable = fakeRollForm(() => "animated");
  wrapAttackSequence(Unreadable, { emit: () => {}, play: () => {}, show: () => true });
  const odd = new Unreadable();
  Object.defineProperty(odd, "actor", { get() { throw new Error("gone"); } });
  odd.object = { rollType: "decisive", accuracyResult: 5, defense: 1 };
  assert.equal(quietly(() => odd.attackSequence()), "animated");
});

test("the roller is wrapped once, however often the hook runs", () => {
  const RollForm = fakeRollForm();
  assert.equal(wrapAttackSequence(RollForm, { emit: () => {}, play: () => {} }), true);
  assert.equal(wrapAttackSequence(RollForm, { emit: () => {}, play: () => {} }), false);
  assert.equal(wrapAttackSequence(undefined), false);
});

test("a roller without attackSequence is left alone", () => {
  class RollForm {}
  assert.equal(wrapAttackSequence(RollForm), false);
  assert.equal(RollForm.prototype.attackSequence, undefined);
});

/* ------------------------------ the socket ------------------------------ */

test("a received cut-in is cleaned before anything is shown", () => {
  const played = [];
  receiveCutIn(
    { type: CUT_IN_MESSAGE, payload: {
      name: "  Rising Tide ", color: "javascript:x", img: "javascript:x", charms: ["A", 5, "A", ""]
    } },
    { play: (p) => played.push(p), show: () => true }
  );
  assert.equal(played.length, 1);
  assert.equal(played[0].name, "Rising Tide");
  assert.equal(played[0].color, CUT_IN_FALLBACK);
  assert.equal(played[0].img, CUT_IN_PORTRAIT);
  assert.deepEqual(played[0].charms, ["A"]);
  assert.equal(cleanCutInPayload({ name: "x", storyteller: "yes" }).storyteller, false);
});

test("other messages, and cut-ins with no attacker, are ignored", () => {
  const played = [];
  const options = { play: (p) => played.push(p), show: () => true };
  receiveCutIn({ type: "somethingElse", payload: { name: "X" } }, options);
  receiveCutIn({ type: CUT_IN_MESSAGE, payload: { name: "" } }, options);
  receiveCutIn({ type: CUT_IN_MESSAGE }, options);
  receiveCutIn(null, options);
  assert.equal(played.length, 0);
});
