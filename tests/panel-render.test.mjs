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

function hero({ name = "Rising Tide", items = [daiklave] } = {}) {
  return {
    name,
    system: {
      power: { value: 4, max: 10 },
      motes: { value: 5, max: 10 },
      poise: { value: 3, max: 3 },
      will: { value: 2 }
    },
    effects: [],
    items
  };
}

function antagonist({ inBreak = true, effects = [] } = {}) {
  return {
    id: "t1", type: "npc", name: "Agent of the Wyld Hunt",
    system: {
      defense: { value: 5 }, soak: { value: 3 }, poise: { value: inBreak ? 0 : 3 },
      resolve: { value: 3 }, health: { penalty: 0 }, pools: { primary: { value: 6 } }
    },
    effects: [...effects, ...(inBreak ? [{ statuses: new Set(["break"]) }] : [])]
  };
}

async function render(actor, { openGambit = null } = {}) {
  const view = new TurnPanel(actor);
  view.openGambit = openGambit;
  return view._renderHTML();
}

const spells = [
  { type: "spell", name: "Lightning Spider", system: { cost: 3, iscontrolspell: true } },
  { type: "spell", name: "Death of Obsidian Butterflies", system: { cost: 5, iscontrolspell: false } }
];

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

test("names written by players are escaped, not rendered as markup", async () => {
  target(null);
  const html = await render(hero({ name: `<img src=x onerror="alert(1)">` }));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
