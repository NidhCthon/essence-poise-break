// Render the panel in each state it has, and the Break effect frame by frame,
// using the module's own code under the same stubbed Foundry the tests use.
// Serve with tools/preview/serve.py.
import { panel, settings, target } from "../../tests/foundry.mjs";

const { TurnPanel, shardLayout, shatterFrame, drawShatter, seedFor, BREAK_COLORS } = panel;

const theme = new URLSearchParams(location.search).get("theme") === "light"
  ? "theme-light" : "theme-dark";
document.body.className = theme;

/* ------------------------------ fixtures ------------------------------ */

const daiklave = {
  type: "weapon", name: "Grand Goremaul", uuid: "Actor.hero.Item.goremaul",
  system: { equipped: true, overwhelming: 3, traits: { weapontags: { selected: { smashing: true } } } }
};
const bow = {
  type: "weapon", name: "Flame Piece", uuid: "Actor.hero.Item.flame",
  system: { equipped: true, overwhelming: 1, traits: { weapontags: { selected: {} } } }
};
const spells = [
  { type: "spell", name: "Lightning Spider", system: { cost: 3, iscontrolspell: true } },
  { type: "spell", name: "Death of Obsidian Butterflies", system: { cost: 5, iscontrolspell: false } }
];

function hero({ poise = { value: 2, max: 3 }, effects = [], items = [daiklave] } = {}) {
  return {
    name: "Rising Tide",
    system: {
      power: { value: 4, max: 10 }, motes: { value: 5, max: 10 },
      poise, hardness: { value: 2 }, will: { value: 3 }
    },
    effects, items
  };
}

function foe({ poise = 3, broken = false, group = false } = {}) {
  return {
    id: "foe", type: "npc", name: group ? "Wyld Hunt Talon" : "Agent of the Wyld Hunt",
    system: {
      defense: { value: 4 }, soak: { value: 3 }, hardness: { value: 3 },
      poise: { value: broken ? 0 : poise, max: 3 }, resolve: { value: 3 },
      health: { penalty: 0 }, battlegroup: group, pools: { primary: { value: 6 } }
    },
    effects: broken ? [{ statuses: new Set(["break"]) }] : []
  };
}

/* ------------------------------- panels ------------------------------- */

function frame(caption, html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<p class="preview-caption">${caption}</p>
    <div class="application essence-poise-break ${theme} preview-frame">
      <header class="window-header">
        <i class="window-icon fa-solid fa-khanda"></i>
        <h1 class="window-title">Poise &amp; Break</h1>
        <button type="button" class="header-control icon fa-solid fa-xmark"></button>
      </header>
      <section class="window-content">${html}</section>
    </div>`;
  document.getElementById("panels").append(wrap);
  return wrap.querySelector(".window-content");
}

async function show(caption, actor, foeActor, { openGambit = null, view = null } = {}) {
  target(foeActor);
  const panelView = view ?? new TurnPanel(actor);
  panelView.openGambit = openGambit;
  return frame(caption, await panelView._renderHTML());
}

await show("Standing: wither them", hero(), foe({ poise: 2 }));

// Rendered straight after a standing render with the same panel, so it carries
// the moment of Break and plays the crack.
const breaking = new TurnPanel(hero({ items: [daiklave, bow, ...spells] }));
target(foe({ poise: 1 }));
await breaking._renderHTML();
target(foe({ broken: true }));
const brokeHtml = await breaking._renderHTML();
const broke = frame("Just Broke: the shards crack once", brokeHtml);

await show("Gambit list open", hero(), foe({ broken: true }), { openGambit: daiklave.uuid });
await show("You are in Break", hero({ poise: { value: 0, max: 3 }, effects: [{ statuses: new Set(["break"]) }] }), foe({ poise: 3 }));
await show("Battle group", hero(), foe({ group: true }));
await show("No target", hero(), null);
settings.set("exaltedessence.combatReforged", false);
await show("Standard rules", hero(), foe());
settings.set("exaltedessence.combatReforged", true);

/* ---------------------------- Break effect ---------------------------- */

const radius = 42;
const steps = [0, 0.12, 0.3, 0.55, 0.8];
const cell = 150;
const app = new PIXI.Application({
  width: cell * (steps.length + 2), height: 200, backgroundColor: 0x2f332c, antialias: true
});
document.getElementById("effect").append(app.view);
const layout = shardLayout(14, seedFor("preview-token"));

function tokenAt(x, label) {
  const disc = new PIXI.Graphics();
  disc.beginFill(0x5d574c).drawCircle(0, 0, radius * 0.9).endFill();
  disc.lineStyle(3, 0xd8d2c0, 0.8).drawCircle(0, 0, radius * 0.9);
  disc.position.set(x, 92);
  app.stage.addChild(disc);
  const graphics = new PIXI.Graphics();
  graphics.position.set(x, 92);
  app.stage.addChild(graphics);
  const text = new PIXI.Text(label, { fill: 0xdad6c8, fontSize: 13, fontFamily: "Signika" });
  text.anchor.set(0.5, 0);
  text.position.set(x, 172);
  app.stage.addChild(text);
  return graphics;
}

steps.forEach((t, i) => {
  const graphics = tokenAt(cell / 2 + i * cell, `t = ${t}`);
  drawShatter(graphics, layout, shatterFrame(t), radius, BREAK_COLORS.jade, BREAK_COLORS.break);
});

const gentle = tokenAt(cell / 2 + steps.length * cell, "photosensitive, t = 0.3");
const gentleFrame = shatterFrame(0.3);
gentleFrame.ringAlpha *= 0.4;
drawShatter(gentle, [], gentleFrame, radius, BREAK_COLORS.jade, BREAK_COLORS.break);

const live = tokenAt(cell / 2 + (steps.length + 1) * cell, "live");
let started = performance.now();
app.ticker.add(() => {
  const t = Math.min(1, (performance.now() - started) / 950);
  drawShatter(live, layout, shatterFrame(t), radius, BREAK_COLORS.jade, BREAK_COLORS.break);
});

document.getElementById("replay").addEventListener("click", () => {
  broke.innerHTML = "";
  void broke.offsetWidth;
  broke.innerHTML = brokeHtml;
  started = performance.now();
});

window.previewReady = true;
