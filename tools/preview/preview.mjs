// Render the panel in each state it has, and the Break effect, the decisive
// cut-in and the anima flare frame by frame, using the module's own code under
// the same stubbed Foundry the tests use.
// Serve with tools/preview/serve.py.
import { panel, settings, target } from "../../tests/foundry.mjs";

const {
  TurnPanel, shardLayout, shatterFrame, drawShatter, seedFor, BREAK_COLORS,
  createBreakText, BREAK_TEXT_DURATION, cutInMarkup,
  emberLayout, flareFrame, drawFlare, flareCaptionMarkup,
  FLARE_EMBERS, FLARE_EMBERS_GENTLE, FLARE_DURATION, FLARE_DURATION_GENTLE,
  breakTextStyle, calloutLines, calloutLayout, calloutSize, CALLOUT_DURATION, CALLOUT_STAGGER,
  ANIMA_TYPE_COLORS, ANIMA_CASTE_COLORS,
  auraFlameLayout, drawAura, AURA_FLAMES, AURA_FLAMES_ICONIC, hitStop,
  createDefeatText, drainScreen,
  poiseNumberText, poiseNumberColor, poiseNumberFrame, poiseNumberSize
} = panel;

/* ----------------------------- Anima colours ----------------------------- */

// Every Exalt type's colour, with its castes beside it, to judge the palette by eye.
{
  const chip = (label, color, big = false) =>
    `<span style="display:inline-flex;align-items:center;gap:6px;margin:0 12px 6px 0">
      <span style="width:${big ? 26 : 18}px;height:${big ? 26 : 18}px;border-radius:4px;background:${color};
        box-shadow:0 0 10px ${color}"></span>${label}</span>`;
  document.getElementById("anima-colors").innerHTML = Object.entries(ANIMA_TYPE_COLORS)
    .map(([type, color]) => `<div style="margin-bottom:8px">${chip(`<b>${type}</b>`, color, true)}${
      Object.entries(ANIMA_CASTE_COLORS[type] ?? {}).map(([caste, c]) => chip(caste, c)).join("")}</div>`)
    .join("");
}

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

/* ------------------------------ Anima flare ------------------------------ */

const flareMoments = [0, 180, 480, 1000, 1600];
const flareApp = new PIXI.Application({
  width: cell * (flareMoments.length + 2), height: 330, backgroundColor: 0x2f332c, antialias: true
});
document.getElementById("flare").append(flareApp.view);
const flareColor = 0xFF6A1A;
// Small, so the whole column fits the frame: it is FLARE_HEIGHT radii tall.
const flareRadius = radius * 0.4;

function flareStage(x, caption, { gentle = false } = {}) {
  const disc = new PIXI.Graphics();
  disc.beginFill(0x5d574c).drawCircle(0, 0, flareRadius * 0.9).endFill();
  disc.lineStyle(3, 0xd8d2c0, 0.8).drawCircle(0, 0, flareRadius * 0.9);
  disc.position.set(x, 250);
  flareApp.stage.addChild(disc);

  const light = new PIXI.Graphics();
  light.blendMode = PIXI.BLEND_MODES.ADD;
  light.position.set(x, 250);
  flareApp.stage.addChild(light);

  const label = new PIXI.Text(caption, { fill: 0xdad6c8, fontSize: 13, fontFamily: "Signika" });
  label.anchor.set(0.5, 0);
  label.position.set(x, 300);
  flareApp.stage.addChild(label);

  const layout = emberLayout(gentle ? FLARE_EMBERS_GENTLE : FLARE_EMBERS, seedFor("preview-flare"));
  return (ms) => drawFlare(
    light, layout,
    flareFrame(ms / (gentle ? FLARE_DURATION_GENTLE : FLARE_DURATION), { gentle }),
    flareRadius, flareColor
  );
}

flareMoments.forEach((ms, i) => flareStage(cell / 2 + i * cell, `${ms} ms`)(ms));
flareStage(cell / 2 + flareMoments.length * cell, "photosensitive, 1200 ms", { gentle: true })(1200);
const liveFlare = flareStage(cell / 2 + (flareMoments.length + 1) * cell, "live");
let flareStarted = performance.now();
flareApp.ticker.add(() => liveFlare((performance.now() - flareStarted) % (FLARE_DURATION + 600)));
document.getElementById("replay-flare").addEventListener("click", () => {
  flareStarted = performance.now();
});

/* ------------------------------ Bonfire aura ----------------------------- */

// At the Break effect's token size, in three colours and both levels, burning
// live; the last is photosensitive mode's halo.
const auraStages = [
  ["bonfire", 0xFF6A1A, "bonfire, solar orange"],
  ["bonfire", 0x1FA34A, "bonfire, wood green"],
  ["iconic", 0x3E7BFF, "iconic, blue"],
  ["iconic", 0xFF6A1A, "photosensitive", true]
];
const auraApp = new PIXI.Application({
  width: cell * auraStages.length, height: 330, backgroundColor: 0x2f332c, antialias: true
});
document.getElementById("aura").append(auraApp.view);
const auraDraws = auraStages.map(([level, color, caption, gentle = false], i) => {
  const x = cell / 2 + i * cell;
  const disc = new PIXI.Graphics();
  disc.beginFill(0x5d574c).drawCircle(0, 0, radius * 0.9).endFill();
  disc.lineStyle(3, 0xd8d2c0, 0.8).drawCircle(0, 0, radius * 0.9);
  disc.position.set(x, 200);
  auraApp.stage.addChild(disc);
  const light = new PIXI.Graphics();
  light.blendMode = PIXI.BLEND_MODES.ADD;
  light.position.set(x, 200);
  auraApp.stage.addChild(light);
  const label = new PIXI.Text(caption, { fill: 0xdad6c8, fontSize: 13, fontFamily: "Signika" });
  label.anchor.set(0.5, 0);
  label.position.set(x, 300);
  auraApp.stage.addChild(label);
  const layout = auraFlameLayout(level === "iconic" ? AURA_FLAMES_ICONIC : AURA_FLAMES, seedFor(`preview-aura-${i}`));
  return (time) => drawAura(light, layout, { time, level, gentle }, radius, color);
});
auraApp.ticker.add(() => {
  const time = performance.now() / 1000;
  for (const draw of auraDraws) draw(time);
});
// The hit-stop and shake, played on the aura's canvas as it would be on the
// board: the flames freeze on the stark frame, then the canvas jolts.
document.getElementById("replay-impact").addEventListener("click", () => hitStop({ board: { app: auraApp } }));

/* ----------------------------- Poise numbers ----------------------------- */

// A withering hit, the hit that Breaks, and Poise coming back in Break, each
// just after it lands and part way up; drawn the way playPoiseNumber draws them.
{
  const cases = [
    [{ amount: -2, broke: false }, 0.2, "withering, 280 ms"],
    [{ amount: -2, broke: false }, 0.55, "withering, 770 ms"],
    [{ amount: -3, broke: true }, 0.2, "the Breaking hit, 280 ms"],
    [{ amount: 2, broke: false }, 0.2, "coming back, 280 ms"]
  ];
  const app = new PIXI.Application({
    width: 220 * cases.length, height: 300, backgroundColor: 0x2f332c, antialias: true
  });
  document.getElementById("poise-numbers").append(app.view);
  const size = poiseNumberSize(radius);
  cases.forEach(([change, t, caption], i) => {
    const cx = 110 + i * 220;
    const cy = 190;
    const disc = new PIXI.Graphics();
    disc.beginFill(0x5d574c).drawCircle(0, 0, radius * 0.9).endFill();
    disc.lineStyle(3, 0xd8d2c0, 0.8).drawCircle(0, 0, radius * 0.9);
    disc.position.set(cx - radius * 0.5, cy);
    app.stage.addChild(disc);
    const holder = new PIXI.Container();
    const number = holder.addChild(new PIXI.Text(poiseNumberText(change), breakTextStyle(PIXI, size)));
    number.anchor.set(0.5, 1);
    const label = holder.addChild(new PIXI.Text("POISE", breakTextStyle(PIXI, Math.round(size * 0.34))));
    label.anchor.set(0.5, 0);
    number.tint = label.tint = poiseNumberColor(change);
    const frame = poiseNumberFrame(t, { broke: change.broke });
    holder.alpha = frame.alpha;
    holder.scale.set(frame.scale);
    holder.position.set(cx - radius * 0.5 + radius * 0.8 + radius * 0.35 * frame.drift, cy - radius * 0.35 - radius * 0.9 * frame.rise);
    app.stage.addChild(holder);
    const text = new PIXI.Text(caption, { fill: 0xdad6c8, fontSize: 13, fontFamily: "Signika" });
    text.anchor.set(0.5, 0);
    text.position.set(cx, 265);
    app.stage.addChild(text);
  });
}

/* -------------------------------- DEFEATED -------------------------------- */

// The word at moments through its fall, landing, hold and sinking, at the
// Break effect's token size; the last is photosensitive mode.
{
  const moments = [[0, "0 ms"], [0.06, "150 ms"], [0.14, "360 ms"], [0.5, "1300 ms"], [0.88, "2300 ms"], [0.5, "photosensitive", true]];
  const app = new PIXI.Application({
    width: 190 * moments.length, height: 260, backgroundColor: 0x2f332c, antialias: true
  });
  document.getElementById("defeat").append(app.view);
  moments.forEach(([t, caption, gentle = false], i) => {
    const x = 95 + i * 190;
    const disc = new PIXI.Graphics();
    disc.beginFill(0x5d574c).drawCircle(0, 0, radius * 0.9).endFill();
    disc.lineStyle(3, 0xd8d2c0, 0.8).drawCircle(0, 0, radius * 0.9);
    disc.position.set(x, 130);
    app.stage.addChild(disc);
    const word = createDefeatText(PIXI, radius, { gentle });
    word.container.position.set(x, 130);
    const holder = new PIXI.Container();
    holder.position.set(x, 130);
    holder.addChild(word.container);
    app.stage.addChild(holder);
    word.update(t);
    const label = new PIXI.Text(caption, { fill: 0xdad6c8, fontSize: 13, fontFamily: "Signika" });
    label.anchor.set(0.5, 0);
    label.position.set(x, 225);
    app.stage.addChild(label);
  });
}

// The drain and vignette, played on the aura's canvas as they would be on the board.
document.getElementById("replay-defeat").addEventListener("click", () => drainScreen({ board: { app: auraApp } }));

// An invented character and iconic anima, nothing from the books.
const riser = {
  name: "Rising Tide", level: "bonfire", color: "#FF6A1A",
  iconic: "A burning phoenix unfolds its wings above her."
};

function flareCaptionFrame(caption, { at, gentle = false } = {}) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<p class="preview-caption">${caption}</p>
    <div class="preview-cutin">${flareCaptionMarkup(riser, { gentle })}</div>`;
  document.getElementById("flare-caption").append(wrap);
  for (const animation of wrap.querySelector(".preview-cutin").getAnimations({ subtree: true })) {
    animation.pause();
    animation.currentTime = at;
  }
}

flareCaptionFrame("caption and edge glow, 300 ms", { at: 300 });
flareCaptionFrame("caption, 1200 ms", { at: 1200 });
flareCaptionFrame("photosensitive or reduced motion, 1200 ms", { at: 1200, gentle: true });

/* ----------------------------- Charm callouts ----------------------------- */

// Invented Charm names, as for the cut-in.
const calledOut = calloutLines(["Tidebreaker Blade", "Crest of the Ninth Wave", "Undertow Grip"]);
const calloutMoments = [60, 300, 700, 1200, 1900];
const calloutCell = 230;
const calloutApp = new PIXI.Application({
  width: calloutCell * (calloutMoments.length + 2), height: 260, backgroundColor: 0x2f332c, antialias: true
});
document.getElementById("callouts").append(calloutApp.view);

function calloutStage(x, caption, { gentle = false } = {}) {
  const disc = new PIXI.Graphics();
  disc.beginFill(0x5d574c).drawCircle(0, 0, radius * 0.9).endFill();
  disc.lineStyle(3, 0xd8d2c0, 0.8).drawCircle(0, 0, radius * 0.9);
  disc.position.set(x, 200);
  calloutApp.stage.addChild(disc);

  const size = calloutSize(radius);
  const style = breakTextStyle(PIXI, size);
  const holder = new PIXI.Container();
  holder.position.set(x, 200);
  const labels = calledOut.map((line) => {
    const text = holder.addChild(new PIXI.Text(line, style));
    text.anchor.set(0.5, 1);
    return text;
  });
  calloutApp.stage.addChild(holder);

  const label = new PIXI.Text(caption, { fill: 0xdad6c8, fontSize: 13, fontFamily: "Signika" });
  label.anchor.set(0.5, 0);
  label.position.set(x, 236);
  calloutApp.stage.addChild(label);

  return (ms) => {
    const layout = calloutLayout(ms, labels.length, { gentle, radius, size, hue: 0x2E8BFF });
    labels.forEach((text, i) => {
      text.alpha = layout[i].alpha;
      text.scale.set(layout[i].scale);
      text.tint = layout[i].tint;
      text.position.set(layout[i].x, layout[i].y);
    });
  };
}

calloutMoments.forEach((ms, i) => calloutStage(calloutCell / 2 + i * calloutCell, `${ms} ms`)(ms));
calloutStage(calloutCell / 2 + calloutMoments.length * calloutCell, "photosensitive, 1100 ms", { gentle: true })(1100);
const liveCallout = calloutStage(calloutCell / 2 + (calloutMoments.length + 1) * calloutCell, "live");
const calloutStarted = performance.now();
const calloutLoop = CALLOUT_DURATION + (calledOut.length - 1) * CALLOUT_STAGGER + 700;
calloutApp.ticker.add(() => liveCallout((performance.now() - calloutStarted) % calloutLoop));

window.previewReady = true;
