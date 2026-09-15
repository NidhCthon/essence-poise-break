// Render the panel in each state it has, and the Break effect and the decisive
// cut-in frame by frame, using the module's own code under the same stubbed
// Foundry the tests use.
// Serve with tools/preview/serve.py.
import { panel, settings, target } from "../../tests/foundry.mjs";

const {
  TurnPanel, shardLayout, shatterFrame, drawShatter, seedFor, BREAK_COLORS,
  createBreakText, BREAK_TEXT_DURATION, cutInMarkup
} = panel;

const theme = new URLSearchParams(location.search).get("theme") === "light"
  ? "theme-light" : "theme-dark";
document.body.className = theme;

/* ------------------------------ fixtures ------------------------------ */

const goremaul = {
  type: "weapon", name: "Grand Goremaul", uuid: "Actor.hero.Item.goremaul",
  system: { equipped: true, overwhelming: 3, traits: { weapontags: { selected: { smashing: true } } } }
};
const flamePiece = {
  type: "weapon", name: "Flame Piece", uuid: "Actor.hero.Item.flame",
  system: { equipped: true, overwhelming: 1, traits: { weapontags: { selected: {} } } }
};
const spells = [
  { type: "spell", name: "Lightning Spider", system: { cost: 3, iscontrolspell: true } },
  { type: "spell", name: "Death of Obsidian Butterflies", system: { cost: 5, iscontrolspell: false } }
];

function hero({ poise = { value: 2, max: 3 }, effects = [], items = [goremaul] } = {}) {
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

async function show(caption, actor, foeActor, { openGambit = null } = {}) {
  target(foeActor);
  const view = new TurnPanel(actor);
  view.openGambit = openGambit;
  return frame(caption, await view._renderHTML());
}

await show("Standing: wither them", hero(), foe({ poise: 2 }));

// Rendered straight after a standing render with the same panel, so it carries
// the moment of Break and plays the crack.
const breaking = new TurnPanel(hero({ items: [goremaul, flamePiece, ...spells] }));
target(foe({ poise: 1 }));
await breaking._renderHTML();
target(foe({ broken: true }));
const brokeHtml = await breaking._renderHTML();
const broke = frame("Just Broke: the shards crack once", brokeHtml);

await show("Gambit list open", hero(), foe({ broken: true }), { openGambit: goremaul.uuid });
await show("You are in Break", hero({ poise: { value: 0, max: 3 }, effects: [{ statuses: new Set(["break"]) }] }), foe({ poise: 3 }));
await show("Battle group", hero(), foe({ group: true }));
await show("No target", hero(), null);
settings.set("exaltedessence.combatReforged", false);
await show("Standard rules", hero(), foe());
settings.set("exaltedessence.combatReforged", true);

/* ---------------------------- Break effect ---------------------------- */

// PIXI measures text when it is created, so the display face has to be loaded
// first or the word is drawn in a fallback font.
await document.fonts.load('40px "Modesto Condensed"');

const SHARD_MS = 950;
const radius = 42;
const moments = [0, 90, 200, 420, 800, 1300];
const cell = 150;
const app = new PIXI.Application({
  width: cell * (moments.length + 2), height: 230, backgroundColor: 0x2f332c, antialias: true
});
document.getElementById("effect").append(app.view);
const layout = shardLayout(14, seedFor("preview-token"));

function stage(x, caption, { gentle = false } = {}) {
  const disc = new PIXI.Graphics();
  disc.beginFill(0x5d574c).drawCircle(0, 0, radius * 0.9).endFill();
  disc.lineStyle(3, 0xd8d2c0, 0.8).drawCircle(0, 0, radius * 0.9);
  disc.position.set(x, 118);
  app.stage.addChild(disc);

  const shards = new PIXI.Graphics();
  shards.position.set(x, 118);
  app.stage.addChild(shards);

  const words = createBreakText(PIXI, radius, { gentle });
  const holder = new PIXI.Container();
  holder.position.set(x, 118);
  holder.addChild(words.container);
  app.stage.addChild(holder);

  const label = new PIXI.Text(caption, { fill: 0xdad6c8, fontSize: 13, fontFamily: "Signika" });
  label.anchor.set(0.5, 0);
  label.position.set(x, 200);
  app.stage.addChild(label);

  return (ms) => {
    const shardFrame = shatterFrame(ms / (gentle ? 1600 : SHARD_MS));
    if (gentle) shardFrame.ringAlpha *= 0.4;
    drawShatter(shards, gentle ? [] : layout, shardFrame, radius, BREAK_COLORS.jade, BREAK_COLORS.break);
    words.update(ms / (gentle ? 2200 : BREAK_TEXT_DURATION));
  };
}

moments.forEach((ms, i) => stage(cell / 2 + i * cell, `${ms} ms`)(ms));
stage(cell / 2 + moments.length * cell, "photosensitive, 900 ms", { gentle: true })(900);

const live = stage(cell / 2 + (moments.length + 1) * cell, "live");
let started = performance.now();
app.ticker.add(() => live(performance.now() - started));

document.getElementById("replay").addEventListener("click", () => {
  broke.innerHTML = "";
  void broke.offsetWidth;
  broke.innerHTML = brokeHtml;
  started = performance.now();
});

/* --------------------------- Decisive cut-in --------------------------- */

// An invented attacker with invented Charm names, and a plain drawn portrait.
const portrait = "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <circle cx="100" cy="74" r="40" fill="#d9c3a0"/>
    <path d="M22 200c8-62 40-92 78-92s70 30 78 92z" fill="#27507a"/>
    <path d="M58 70c0-34 20-52 42-52s42 18 42 52c-10-16-24-24-42-24s-32 8-42 24z" fill="#1b1a22"/>
  </svg>`);
const attacker = {
  name: "Rising Tide", img: portrait, color: "#2E8BFF",
  charms: ["Tidebreaker Blade", "Crest of the Ninth Wave", "Undertow Grip", "Salt-Wind Stance"]
};

function cutInFrame(caption, { at = null, gentle = false, charms = attacker.charms } = {}) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<p class="preview-caption">${caption}</p><div class="preview-cutin"></div>`;
  document.getElementById("cutin").append(wrap);
  const stageElement = wrap.querySelector(".preview-cutin");
  const draw = () => {
    stageElement.innerHTML = cutInMarkup(attacker, { charms, gentle });
    if (at === null) return;
    // Frozen at one moment: each animation paused and moved to that time.
    for (const animation of stageElement.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = at;
    }
  };
  draw();
  return draw;
}

for (const ms of [120, 330, 800, 1450]) cutInFrame(`${ms} ms`, { at: ms });
cutInFrame("photosensitive or reduced motion, 900 ms", { at: 900, gentle: true });
cutInFrame("an antagonist's, Charms kept from players, 800 ms", { at: 800, charms: [] });
const replayCutIn = cutInFrame("live");
document.getElementById("replay-cutin").addEventListener("click", replayCutIn);

window.previewReady = true;
