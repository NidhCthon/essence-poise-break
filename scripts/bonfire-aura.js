/**
 * Poise & Break - The Bonfire aura.
 */

import { CUT_IN_FALLBACK, cutInColor } from "./cut-in.js";
import { FLARE_RANK, animaRank } from "./anima-flare.js";
import { MODULE_ID, effectEnabled } from "./core.js";
import { animaColorFor } from "./anima-colors.js";
import { mixColor, photosensitive, seedFor, seededRandom } from "./break-effect.js";

/* -------------------------------------------- */
/*  The Bonfire aura                            */
/* -------------------------------------------- */

/**
 * The Bonfire aura: the flare marks the moment anima reaches Bonfire, and the
 * aura keeps it showing afterwards. For as long as a character stays at
 * Bonfire or Iconic, tongues of flame in their anima colour lick up from the
 * rim of their token over a breathing halo, and they die away when the anima
 * falls.
 *
 * Nothing is sent between clients. Every client already has the actor, and the
 * system derives the level from it, so each works out for itself which tokens
 * on its own scene are burning, and one ticker draws them all. The flames start
 * at the token's edge and lean outwards, so the token's art stays clear.
 */
const AURA_FLAMES = 18;
const AURA_FLAMES_ICONIC = 26;
/** How far the tallest flame reaches past the rim, in token radii. */
const AURA_REACH = 1.5;
const AURA_REACH_ICONIC = 2.4;
/** Seconds to kindle, and to die away. */
const AURA_FADE = 0.8;

function showingAura() {
  return effectEnabled("bonfireAura");
}

/** "bonfire" or "iconic" while an actor's aura burns, otherwise null. */
function auraLevel(actor) {
  const level = actor?.system?.anima?.level;
  if (animaRank(level) < FLARE_RANK) return null;
  return level === "iconic" ? "iconic" : "bonfire";
}

/** The flames round a token, spaced evenly and the same each time for it. */
function auraFlameLayout(count, seed) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    angle: (i / count) * Math.PI * 2 + (random() - 0.5) * 0.3,
    length: 0.6 + random() * 0.4,
    width: 0.36 + random() * 0.16,
    speed: 1.6 + random() * 1.6,
    phase: random() * Math.PI * 2
  }));
}

/** How far the aura has kindled or died away, from 0 to 1, at `now` seconds. */
function auraFade(now, { born = now, dying = null } = {}) {
  const kindled = Math.min(1, Math.max(0, (now - born) / AURA_FADE));
  const left = dying === null ? 1 : Math.max(0, 1 - (now - dying) / AURA_FADE);
  return Math.min(kindled, left);
}

/**
 * One frame of the aura, `time` seconds into it. The halo is a few wide rings
 * just outside the token. Each flame rises from the rim, leaning up as well as
 * out: longest over the top, shortest underneath, as fire does. Photosensitive
 * mode keeps only the halo, breathing slowly.
 */
function drawAura(graphics, layout, { time = 0, fade = 1, level = "bonfire", gentle = false } = {}, radius, color) {
  graphics.clear();
  if (!(fade > 0) || !(radius > 0)) return;
  const core = mixColor(color, 0xFFFFFF, 0.65);
  const breath = gentle
    ? 0.6 + 0.4 * Math.sin(time * Math.PI / 3)
    : 0.85 + 0.15 * Math.sin(time * 2.4);

  for (let i = 0; i < 3; i++) {
    graphics.lineStyle(radius * 0.2, color, fade * breath * (gentle ? 0.14 : 0.2) * (3 - i) / 3);
    graphics.drawCircle(0, 0, radius * (1.06 + 0.17 * i));
  }
  graphics.lineStyle(0);
  if (gentle) return;

  const reach = radius * (level === "iconic" ? AURA_REACH_ICONIC : AURA_REACH);
  for (const flame of layout) {
    const outX = Math.cos(flame.angle);
    const outY = Math.sin(flame.angle);
    // Out from the rim, turned upwards - except underneath, where turning up
    // would send the flame back into the token.
    const lean = 1.1 * (1 - Math.max(0, outY));
    const along = Math.hypot(outX, outY - lean);
    const dirX = outX / along;
    const dirY = (outY - lean) / along;
    const sideX = -dirY;
    const sideY = dirX;
    const upness = 0.3 + 0.7 * ((1 - outY) / 2) ** 1.3;
    const flicker = 0.78 + 0.16 * Math.sin(time * flame.speed * 2 + flame.phase)
      + 0.06 * Math.sin(time * flame.speed * 5.3 + flame.phase * 2);
    const length = reach * flame.length * upness * flicker;
    const width = radius * flame.width;
    const sway = Math.sin(time * flame.speed * 1.3 + flame.phase) * width * 0.45;
    const baseX = outX * radius;
    const baseY = outY * radius;

    const tongue = (scale, lengthScale) => {
      const w = width * scale / 2;
      const l = length * lengthScale;
      const shoulder = l * 0.35;
      return [
        baseX + sideX * w, baseY + sideY * w,
        baseX + dirX * shoulder + sideX * w * 1.15, baseY + dirY * shoulder + sideY * w * 1.15,
        baseX + dirX * l + sideX * sway, baseY + dirY * l + sideY * sway,
        baseX + dirX * shoulder - sideX * w * 1.15, baseY + dirY * shoulder - sideY * w * 1.15,
        baseX - sideX * w, baseY - sideY * w
      ];
    };
    graphics.beginFill(color, fade * breath * 0.5);
    graphics.drawPolygon(tongue(1, 1));
    graphics.endFill();
    graphics.beginFill(core, fade * breath * 0.55);
    graphics.drawPolygon(tongue(0.45, 0.6));
    graphics.endFill();
  }
}

/** Every aura on this client's canvas, by token id. */
const auras = new Map();
let auraTicker = null;

const auraClock = () => (globalThis.performance?.now?.() ?? Date.now()) / 1000;

function auraColor(actor) {
  try {
    return parseInt(cutInColor(animaColorFor(actor)).slice(1), 16);
  } catch (err) {
    return parseInt(CUT_IN_FALLBACK.slice(1), 16);
  }
}

/** The tokens on the canvas that should be burning, with their level and colour. */
function wantedAuras(tokens) {
  const wanted = new Map();
  if (!showingAura()) return wanted;
  for (const token of tokens ?? []) {
    if (!token?.id || token.destroyed) continue;
    const level = auraLevel(token.actor);
    if (level) wanted.set(token.id, { token, level, color: auraColor(token.actor) });
  }
  return wanted;
}

function removeAura(id) {
  const aura = auras.get(id);
  auras.delete(id);
  if (aura && !aura.container.destroyed) aura.container.destroy({ children: true });
}

function stopAuraTicker() {
  if (!auraTicker) return;
  try {
    auraTicker.ticker.remove(auraTicker.tick);
  } catch (err) {
    // The canvas's ticker went with the canvas.
  }
  auraTicker = null;
}

/** Tear every aura down, as the canvas is. */
function clearAuras() {
  for (const id of [...auras.keys()]) removeAura(id);
  stopAuraTicker();
}

/**
 * Draw every aura for this frame: follow each token as it moves, hide it where
 * the player cannot see the token, and finish off any that have died away.
 */
function tickAuras(now = auraClock(), board = globalThis.canvas) {
  const gentle = board?.photosensitiveMode === true || photosensitive();
  for (const [id, aura] of [...auras]) {
    const { token, container, graphics } = aura;
    if (container.destroyed || graphics.destroyed || token.destroyed) {
      removeAura(id);
      continue;
    }
    const fade = auraFade(now, aura);
    if (aura.dying !== null && fade <= 0) {
      removeAura(id);
      continue;
    }
    const w = token.w ?? 0;
    const h = token.h ?? 0;
    container.position.set((token.x ?? 0) + w / 2, (token.y ?? 0) + h / 2);
    container.visible = !!token.isVisible;
    if (!container.visible) continue;
    drawAura(graphics, aura.layout, { time: now, fade, level: aura.level, gentle }, Math.max(w, h) / 2, aura.color);
  }
  if (!auras.size) stopAuraTicker();
}

function startAuraTicker(board) {
  if (auraTicker) return;
  const ticker = board?.app?.ticker ?? globalThis.PIXI?.Ticker?.shared;
  if (!ticker?.add) return;
  const tick = () => {
    try {
      tickAuras();
    } catch (err) {
      console.warn(`${MODULE_ID} | could not draw the Bonfire aura`, err);
      clearAuras();
    }
  };
  ticker.add(tick);
  auraTicker = { ticker, tick };
}

/**
 * Bring the auras into line with the actors: kindle one for each token that
 * has risen into Bonfire, let those that have fallen die away, and follow a
 * change of level or colour. Run whenever an actor, a token, the scene or the
 * setting changes; it only ever touches what differs.
 */
function syncAuras({ board = globalThis.canvas, now = auraClock() } = {}) {
  const pixi = globalThis.PIXI;
  if (!pixi || !board?.interface) return auras;
  const wanted = wantedAuras(board.tokens?.placeables);

  for (const [id, aura] of auras) {
    if (!wanted.has(id) && aura.dying === null) aura.dying = now;
  }
  for (const [id, want] of wanted) {
    const aura = auras.get(id);
    if (aura && aura.token === want.token && !aura.container.destroyed) {
      if (aura.dying !== null) {
        // Back up before it went out: carry on from how bright it still is.
        aura.born = now - AURA_FADE * auraFade(now, aura);
        aura.dying = null;
      }
      if (aura.level !== want.level) {
        aura.level = want.level;
        aura.layout = auraFlameLayout(want.level === "iconic" ? AURA_FLAMES_ICONIC : AURA_FLAMES, seedFor(id));
      }
      aura.color = want.color;
      continue;
    }
    if (aura) removeAura(id);

    const container = new pixi.Container();
    container.eventMode = "none";
    const graphics = container.addChild(new pixi.Graphics());
    if (pixi.BLEND_MODES) graphics.blendMode = pixi.BLEND_MODES.ADD;
    // Above the token layer, as the Break effect must be, and just under the
    // flare and the floating text, so those play over it.
    container.zIndex = (CONFIG.Canvas?.groups?.interface?.zIndexScrollingText ?? 1100) - 1;
    board.interface.addChild(container);
    auras.set(id, {
      token: want.token,
      container,
      graphics,
      level: want.level,
      color: want.color,
      layout: auraFlameLayout(want.level === "iconic" ? AURA_FLAMES_ICONIC : AURA_FLAMES, seedFor(id)),
      born: now,
      dying: null
    });
  }

  if (auras.size) startAuraTicker(board);
  return auras;
}

/** syncAuras for a hook, where nothing it does wrong may reach the caller. */
function syncAurasSafely() {
  try {
    syncAuras();
  } catch (err) {
    console.warn(`${MODULE_ID} | could not update the Bonfire aura`, err);
  }
}

export {
  AURA_FADE,
  AURA_FLAMES,
  AURA_FLAMES_ICONIC,
  AURA_REACH,
  AURA_REACH_ICONIC,
  auraClock,
  auraColor,
  auraFade,
  auraFlameLayout,
  auraLevel,
  auraTicker,
  auras,
  clearAuras,
  drawAura,
  removeAura,
  showingAura,
  startAuraTicker,
  stopAuraTicker,
  syncAuras,
  syncAurasSafely,
  tickAuras,
  wantedAuras
};
