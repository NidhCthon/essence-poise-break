// The whole panel, rendered through TurnPanel's own _renderHTML(), so the
// private blocks are checked as a player sees them rather than prised out of
// the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings, target, text } from "./foundry.mjs";

const { TurnPanel } = panel;

const daiklave = {
  type: "weapon", name: "Daiklave", uuid: "Actor.hero.Item.daiklave",
  system: { equipped: true, overwhelming: 2, traits: { weapontags: { selected: {} } } }
};

function hero({ name = "Rising Tide", items = [daiklave], poise = { value: 3, max: 3 } } = {}) {
  return {
    name,
    system: {
      power: { value: 4, max: 10 },
      motes: { value: 5, max: 10 },
      poise,
      hardness: { value: 2 },
      will: { value: 2 }
    },
    effects: [],
    items
  };
}

function antagonist({ inBreak = true, effects = [], poise = 3 } = {}) {
  return {
    id: "t1", type: "npc", name: "Agent of the Wyld Hunt",
    system: {
      defense: { value: 5 }, soak: { value: 3 }, poise: { value: inBreak ? 0 : poise, max: 3 },
      resolve: { value: 3 }, health: { penalty: 0 }, pools: { primary: { value: 6 } }
    },
    effects: [...effects, ...(inBreak ? [{ statuses: new Set(["break"]) }] : [])]
  };
}

async function render(actor, { openGambit = null, view = null } = {}) {
  const panelView = view ?? new TurnPanel(actor);
  panelView.openGambit = openGambit;
  return panelView._renderHTML();
}

/** The target and verdict card, on its own. */
const faceoff = (html) => html.slice(html.indexOf('class="epb-faceoff"'));

const spells = [
  { type: "spell", name: "Lightning Spider", system: { cost: 3, iscontrolspell: true } },
  { type: "spell", name: "Death of Obsidian Butterflies", system: { cost: 5, iscontrolspell: false } }
];

/* ------------------------------- sorcery ------------------------------ */

test("a control spell costs its printed Will while the rule is off", async () => {
  target(antagonist());
  const shown = text(await render(hero({ items: [daiklave, ...spells] })));
  assert.match(shown, /Lightning Spider 3 Will/);
  assert.doesNotMatch(shown, /\(3 - 1\)/);
});

test("with control spells in play, it shows the reduced cost and why", async () => {
  target(antagonist());
  settings.set("essence-poise-break.controlSpells", true);
  try {
    const shown = text(await render(hero({ items: [daiklave, ...spells] })));
    assert.match(shown, /Lightning Spider \* 2 Will \(3 - 1\)/);
    assert.match(shown, /Death of Obsidian Butterflies 5 Will/);
    assert.match(shown, /control spell/);
  } finally {
    settings.set("essence-poise-break.controlSpells", false);
  }
});

test("someone with no spells or rituals gets no sorcery block", async () => {
  target(antagonist());
  assert.doesNotMatch(text(await render(hero())), /Focus Will/);
});

/* ---------------------------- social, gambits ------------------------- */

test("the social block quotes Resolve untouched by the target's conditions", async () => {
  target(antagonist({ effects: [{ name: "prone" }] }));
  assert.match(text(await render(hero())), /3 successes to move Agent of the Wyld Hunt/);
});

test("the gambit list opens under its weapon and says which gambits the panel finishes", async () => {
  target(antagonist());
  const closed = text(await render(hero()));
  assert.doesNotMatch(closed, /Reveal Weakness/, "the list should start closed");

  const open = text(await render(hero(), { openGambit: daiklave.uuid }));
  assert.match(open, /Knockback 4 Power/);
  assert.equal(open.match(/the panel applies the Defense penalty itself/g)?.length, 1,
    "only Knockback carries that note");
  assert.match(open, /supplies both the Power and the -1 Defense/);
});

test("a standing target disables the gambit button rather than hiding it", async () => {
  target(antagonist({ inBreak: false }));
  const html = await render(hero());
  assert.match(html, /data-action="gambitMenu"[^>]*disabled/);
});

/* ------------------------------ Poise shards -------------------------- */

test("a standing target's Poise shows as shards, full for what is left", async () => {
  target(antagonist({ inBreak: false, poise: 2 }));
  const card = faceoff(await render(hero()));
  assert.match(card, /aria-label="Poise 2 of 3"/);
  assert.equal(card.match(/epb-shard is-full/g)?.length, 2);
  assert.equal(card.match(/class="epb-shard/g)?.length, 3);
  assert.doesNotMatch(card, /is-broken/);
});

test("a target in Break shows every shard cracked, and says so to a screen reader", async () => {
  target(antagonist());
  const card = faceoff(await render(hero()));
  assert.match(card, /epb-poise is-broken/);
  assert.match(card, /aria-label="In Break, Poise 0 of 3"/);
  assert.doesNotMatch(card, /is-full/);
});

test("battle groups and standard rules draw no Poise at all", async () => {
  target({ ...antagonist({ inBreak: false }), system: { ...antagonist({ inBreak: false }).system, battlegroup: true } });
  assert.doesNotMatch(faceoff(await render(hero())), /epb-poise/);

  settings.set("exaltedessence.combatReforged", false);
  try {
    target(antagonist({ inBreak: false }));
    assert.doesNotMatch(faceoff(await render(hero())), /epb-poise/);
  } finally {
    settings.set("exaltedessence.combatReforged", true);
  }
});

test("your own Poise sits beside your name under Reforged, and Hardness without it", async () => {
  target(null);
  const withPoise = await render(hero({ poise: { value: 1, max: 3 } }));
  assert.match(withPoise, /epb-poise is-small[^>]*aria-label="Poise 1 of 3"/);

  settings.set("exaltedessence.combatReforged", false);
  try {
    const shown = await render(hero());
    assert.doesNotMatch(shown, /epb-poise/);
    assert.match(text(shown), /2 Hardness/);
  } finally {
    settings.set("exaltedessence.combatReforged", true);
  }
});

test("more Poise than there is room for is capped in shards, but not in the count", async () => {
  target(null);
  const html = await render(hero({ poise: { value: 12, max: 12 } }));
  assert.equal(html.match(/class="epb-shard/g)?.length, 10);
  assert.match(html, /aria-label="Poise 12 of 12"/);
  // text() turns the closing </b> into a space: "<b>12</b>/12" reads "12 /12".
  assert.match(text(html), /12 ?\/12 Poise/);
});

test("the render that first finds a target in Break marks it, and only that one", async () => {
  const view = new TurnPanel(hero());
  target(antagonist({ inBreak: false }));
  assert.doesNotMatch(await render(null, { view }), /data-just-broke/);

  target(antagonist());
  assert.match(await render(null, { view }), /data-just-broke="true"/);

  assert.doesNotMatch(await render(null, { view }), /data-just-broke/,
    "a refresh while they stay in Break must not crack the shards again");
});

test("a different target already in Break is not a moment", async () => {
  const view = new TurnPanel(hero());
  target({ ...antagonist({ inBreak: false }), id: "someone-else" });
  await render(null, { view });
  target(antagonist());
  assert.doesNotMatch(await render(null, { view }), /data-just-broke/);
});

test("photosensitive mode marks the card so the crack plays without motion", async () => {
  target(antagonist());
  settings.set("core.photosensitiveMode", true);
  try {
    assert.match(await render(hero()), /data-gentle="true"/);
  } finally {
    settings.delete("core.photosensitiveMode");
  }
});

/* ------------------------------- safety ------------------------------- */

test("names written by players are escaped, not rendered as markup", async () => {
  target(null);
  const html = await render(hero({ name: `<img src=x onerror="alert(1)">` }));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
