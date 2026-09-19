/**
 * Poise & Break - The anima flare.
 */

import { CUT_IN_SOCKET, cutInColor } from "./cut-in.js";
import { MODULE_ID, effectEnabled } from "./core.js";
import { animaColorFor } from "./anima-colors.js";
import { esc } from "./rules.js";
import { mixColor, photosensitive, seedFor, seededRandom } from "./break-effect.js";

/* -------------------------------------------- */
/*  The anima flare                             */
/* -------------------------------------------- */

/**
 * The anima flare: when a character's anima rises into Bonfire, or on into
 * Iconic, a column of light in their anima colour erupts from their token, and
 * a caption and an edge glow mark it on screen.
 *
 * The level comes from the system, which derives it from the anima value each
 * time the actor is prepared, so nothing here repeats its thresholds. The
 * client that changes an actor notes the level before the change
 * (preUpdateActor) and reads it after (updateActor). If it rose into a flare,
 * that client plays it and sends it to everyone else over the module's socket,
 * and each client decides whether its player can see the token.
 */
const FLARE_MESSAGE = "animaFlare";
/** Matched by the caption's animations in styles/anima-flare.css. */
const FLARE_DURATION = 2200;
const FLARE_DURATION_GENTLE = 3000;
const FLARE_EMBERS = 18;
const FLARE_EMBERS_GENTLE = 6;
/**
 * How far the column rises and how wide its sheath is, in token radii. The
 * first column, seven radii by a little over half, read as a thin candle over
 * a token at the table, so both grew.
 */
const FLARE_HEIGHT = 12;
const FLARE_WIDTH = 0.85;
const FLARE_ICONIC_MAX = 110;
/** The system's anima levels, lowest first; "" is no anima showing. */
const ANIMA_LEVELS = ["", "dim", "glowing", "burning", "bonfire", "iconic"];
const FLARE_RANK = ANIMA_LEVELS.indexOf("bonfire");

function showingFlare() {
  return effectEnabled("animaFlare");
}

/** Where an anima level sits in the system's order. Anything unknown is none. */
function animaRank(level) {
  const rank = ANIMA_LEVELS.indexOf(level);
  return rank === -1 ? 0 : rank;
}

/**
 * A rise into Bonfire, or on into Iconic. The system's alternate anima track
 * goes from burning straight to iconic, which counts too.
 */
function crossesIntoFlare(from, to) {
  return to >= FLARE_RANK && to > from;
}

/** The first sentence of a sheet's iconic anima, as plain text short enough to read. */
function iconicLine(value) {
  if (typeof value !== "string") return "";
  const plain = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return "";
  const sentence = /^.+?[.!?](?=\s|$)/.exec(plain)?.[0] ?? plain;
  return sentence.length > FLARE_ICONIC_MAX
    ? `${sentence.slice(0, FLARE_ICONIC_MAX - 1).trimEnd()}…`
    : sentence;
}

function flareLevelLabel(level) {
  return level === "iconic" ? "Iconic" : "Bonfire";
}

/**
 * What a flare carries, made safe. Like the cut-in it can arrive from another
 * client, so the level must be one that flares, the token and scene must be
 * named, the colour is checked and the iconic text is made plain.
 */
function cleanFlarePayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const name = text(raw.name, 80);
  const tokenId = text(raw.tokenId, 64);
  const sceneId = text(raw.sceneId, 64);
  const level = raw.level === "bonfire" || raw.level === "iconic" ? raw.level : null;
  if (!name || !tokenId || !sceneId || !level) return null;
  return {
    actorUuid: text(raw.actorUuid, 200) || null,
    tokenId,
    sceneId,
    name,
    color: cutInColor(raw.color),
    level,
    iconic: iconicLine(raw.iconic)
  };
}

/**
 * The flare for an actor now in Bonfire or Iconic, or null when there is no
 * token for it to erupt from. An unlinked token's actor carries its own token;
 * a linked actor's is looked for on this client's scene. An antagonist's iconic
 * anima text stays with the Storyteller.
 */
function animaFlarePayload(actor) {
  if (!actor) return null;
  const level = actor.system?.anima?.level;
  if (animaRank(level) < FLARE_RANK) return null;
  let token = null;
  try {
    token = actor.token ?? actor.getActiveTokens?.()?.[0] ?? null;
  } catch (err) {
    token = null;
  }
  const tokenDocument = token?.document ?? token;
  return cleanFlarePayload({
    actorUuid: actor.uuid,
    tokenId: tokenDocument?.id,
    sceneId: tokenDocument?.parent?.id,
    name: actor.name,
    color: animaColorFor(actor),
    level,
    iconic: actor.hasPlayerOwner ? actor.system?.anima?.iconic : ""
  });
}

/** Does this update set the anima value, nested or as a flattened key? */
function changesAnima(changes) {
  if (!changes || typeof changes !== "object") return false;
  if (Object.hasOwn(changes, "system.anima.value")) return true;
  const anima = changes.system?.anima;
  return !!anima && typeof anima === "object" && Object.hasOwn(anima, "value");
}

/** Each actor's anima rank just before this client changed it. */
const animaBefore = new Map();

/** preUpdateActor, on the client making the change: remember the level it had. */
function recordAnimaBefore(actor, changes, userId) {
  if (userId !== undefined && userId !== game.user?.id) return false;
  if (!actor?.uuid || !changesAnima(changes)) return false;
  animaBefore.set(actor.uuid, animaRank(actor.system?.anima?.level));
  return true;
}

/**
 * updateActor, on the same client: the system has worked out the new level by
 * now, so compare, and play and send the flare if it rose into one. Every step
 * after the comparison is caught, so a flare can never disturb an update.
 */
function animaAfterUpdate(actor, userId, {
  emit = (message) => game.socket?.emit(CUT_IN_SOCKET, message),
  play = playFlare,
  show = shouldShowFlare
} = {}) {
  if (userId !== undefined && userId !== game.user?.id) return null;
  if (!actor?.uuid || !animaBefore.has(actor.uuid)) return null;
  const from = animaBefore.get(actor.uuid);
  animaBefore.delete(actor.uuid);
  if (!crossesIntoFlare(from, animaRank(actor.system?.anima?.level))) return null;

  let payload = null;
  try {
    payload = animaFlarePayload(actor);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not read the actor for the anima flare`, err);
  }
  if (!payload) return null;
  try {
    emit({ type: FLARE_MESSAGE, payload });
  } catch (err) {
    console.warn(`${MODULE_ID} | could not send the anima flare`, err);
  }
  try {
    if (show(payload)) play(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not play the anima flare`, err);
  }
  return payload;
}

/** The flaring token, if it is on the scene this client is viewing. */
function flareToken(payload) {
  const board = globalThis.canvas;
  if (!payload?.tokenId || !board?.scene?.id || board.scene.id !== payload.sceneId) return null;
  return board.tokens?.get?.(payload.tokenId) ?? null;
}

/**
 * Should this client show the flare? It belongs to a place on the map, so only
 * for a token on the scene this player is viewing - and, as with Break,
 * Token#isVisible decides, so a hidden token gives nothing away.
 */
function shouldShowFlare(payload) {
  if (!payload || !showingFlare()) return false;
  const token = flareToken(payload);
  return !!token && !!token.isVisible && !token.destroyed;
}

/** The flare at progress t, from 0 to 1. */
function flareFrame(t, { gentle = false } = {}) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  if (gentle) {
    // Photosensitive mode: the column is there at once, faint, and only fades
    // in and out. No ring, no flicker.
    return {
      t: p,
      rise: 1,
      alpha: 0.55 * (p < 0.25 ? p / 0.25 : p > 0.6 ? Math.max(0, (1 - p) / 0.4) : 1),
      flicker: 1,
      glow: 0.6,
      ringScale: 1,
      ringAlpha: 0
    };
  }
  const burst = Math.min(1, p / 0.45);
  return {
    t: p,
    // Shoots up in the first fifth and a bit.
    rise: 1 - (1 - Math.min(1, p / 0.22)) ** 3,
    // Divided by (1 - 0.62), not 0.38: in floating point that reaches exactly
    // 0 at the end.
    alpha: p < 0.05 ? p / 0.05 : p > 0.62 ? Math.max(0, (1 - p) / (1 - 0.62)) : 1,
    flicker: p > 0.15 ? 1 + 0.07 * Math.sin(p * 90) : 1,
    glow: 1,
    ringScale: 1 + 2 * (1 - (1 - burst) ** 3),
    ringAlpha: p < 0.45 ? 0.9 * (1 - burst) : 0
  };
}

/** Embers rising through the column, laid out the same way each time for a token. */
function emberLayout(count, seed) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => ({
    offset: (random() - 0.5) * 1.0,
    drift: (random() - 0.5) * 0.4,
    speed: 0.55 + random() * 0.5,
    size: 0.035 + random() * 0.05,
    delay: random() * 0.35
  }));
}

/**
 * One frame of the flare, drawn into a PIXI.Graphics with the PIXI 7 API that
 * Foundry 14 bundles: a pool of light at the foot, the column as stacked bands
 * of a coloured sheath round a white-hot core, the ring, and the embers. Kept
 * apart from the canvas so it can be tested and previewed on its own.
 */
function drawFlare(graphics, layout, frame, radius, color) {
  graphics.clear();
  if (frame.alpha <= 0 && frame.ringAlpha <= 0) return;
  const core = mixColor(color, 0xFFFFFF, 0.7);
  const base = radius * 0.55;
  const height = radius * FLARE_HEIGHT * frame.rise;

  // Faintest where it is widest.
  for (let i = 3; i >= 1; i--) {
    graphics.beginFill(color, frame.alpha * frame.glow * 0.1 * (4 - i));
    graphics.drawCircle(0, base * 0.3, radius * (0.5 + 0.45 * i));
    graphics.endFill();
  }

  if (height > 0) {
    const bands = 16;
    const step = height / bands;
    for (let i = 0; i < bands; i++) {
      const along = i / bands;
      const fade = (1 - along) ** 1.6;
      const sheath = radius * FLARE_WIDTH * frame.flicker * (1 - 0.45 * along);
      const top = base - step * (i + 1);
      // Each band exactly its own height. Overlapping them, in added light,
      // doubles the brightness where they meet and stripes the column.
      graphics.beginFill(color, frame.alpha * 0.5 * fade);
      graphics.drawRect(-sheath, top, sheath * 2, step);
      graphics.endFill();
      graphics.beginFill(core, frame.alpha * 0.85 * fade);
      graphics.drawRect(-sheath * 0.36, top, sheath * 0.72, step);
      graphics.endFill();
    }
  }

  if (frame.ringAlpha > 0) {
    graphics.lineStyle(Math.max(1, radius * 0.1 * (1 - frame.ringScale / 4)), core, frame.ringAlpha);
    graphics.drawCircle(0, base * 0.3, radius * frame.ringScale);
    graphics.lineStyle(0);
  }

  for (const ember of layout) {
    const p = (frame.t - ember.delay) / (1 - ember.delay);
    if (p <= 0 || p >= 1) continue;
    graphics.beginFill(core, frame.alpha * (1 - p));
    graphics.drawCircle(
      radius * (ember.offset + ember.drift * p),
      base - radius * FLARE_HEIGHT * ember.speed * p,
      radius * ember.size
    );
    graphics.endFill();
  }
}

/** The flare's caption and edge glow. Every name in it is escaped. */
function flareCaptionMarkup(payload, { gentle = false } = {}) {
  const iconic = payload?.iconic
    ? `<span class="epb-flare-iconic">${esc(payload.iconic)}</span>`
    : "";
  return `<div class="epb-flare" style="--epb-flare-color: ${cutInColor(payload?.color)}"${
    gentle ? ` data-gentle="true"` : ""} aria-hidden="true">
    <div class="epb-flare-edges"></div>
    <div class="epb-flare-caption">
      <span class="epb-flare-level">${esc(flareLevelLabel(payload?.level))}</span>
      <span class="epb-flare-name">${esc(payload?.name)}</span>
      ${iconic}
    </div>
  </div>`;
}

/**
 * Play the column on one token, in the interface canvas group above the
 * tokens like the Break effect, and in added light, so it brightens the map
 * under it rather than covering it. Destroyed when it ends, or found already
 * destroyed if the canvas was torn down around it.
 */
async function playAnimaFlare(token, payload) {
  const pixi = globalThis.PIXI;
  const board = globalThis.canvas;
  const CanvasAnimation = foundry.canvas?.animation?.CanvasAnimation;
  if (!pixi || !board?.interface || !CanvasAnimation || !token?.center) return;

  const radius = Math.max(token.w ?? 0, token.h ?? 0) / 2;
  if (!radius) return;
  const gentle = board.photosensitiveMode === true || photosensitive();
  const color = parseInt(cutInColor(payload?.color).slice(1), 16);

  if (!gentle && token.hasDynamicRing && token.ring?.flashColor && foundry.utils?.Color) {
    token.ring.flashColor(foundry.utils.Color.from(color), { duration: 1400 })
      ?.catch?.(() => {});
  }

  const container = new pixi.Container();
  container.eventMode = "none";
  container.position.set(token.center.x, token.center.y);
  const graphics = container.addChild(new pixi.Graphics());
  if (pixi.BLEND_MODES) graphics.blendMode = pixi.BLEND_MODES.ADD;
  // Above the token layer, for the reason the Break effect gives.
  container.zIndex = CONFIG.Canvas?.groups?.interface?.zIndexScrollingText ?? 1100;
  board.interface.addChild(container);

  const layout = emberLayout(gentle ? FLARE_EMBERS_GENTLE : FLARE_EMBERS, seedFor(token.id));
  const state = { t: 0 };
  const draw = () => {
    if (graphics.destroyed) return;
    drawFlare(graphics, layout, flareFrame(state.t, { gentle }), radius, color);
  };

  try {
    draw();
    await CanvasAnimation.animate(
      [{ parent: state, attribute: "t", from: 0, to: 1 }],
      {
        name: `${MODULE_ID}.flare.${token.id}`,
        context: container,
        duration: gentle ? FLARE_DURATION_GENTLE : FLARE_DURATION,
        ontick: draw
      }
    );
  } catch (err) {
    console.error(`${MODULE_ID} | could not play the anima flare`, err);
  } finally {
    if (!container.destroyed) container.destroy({ children: true });
  }
}

/** The caption on screen now, so a second replaces it rather than stacking. */
let flareShowing = null;

/** Put the caption and edge glow on this client's screen, then take them down. */
function playFlareCaption(payload, { doc = globalThis.document } = {}) {
  if (!payload || !doc?.body) return null;
  const reducedMotion = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const gentle = photosensitive() || reducedMotion;
  flareShowing?.remove();
  const layer = doc.createElement("div");
  layer.className = "epb-flare-layer";
  layer.innerHTML = flareCaptionMarkup(payload, { gentle });
  doc.body.append(layer);
  flareShowing = layer;
  setTimeout(() => {
    layer.remove();
    if (flareShowing === layer) flareShowing = null;
  }, gentle ? FLARE_DURATION_GENTLE : FLARE_DURATION);
  return layer;
}

/** The whole flare on this client: the column at the token, and the caption. */
function playFlare(payload) {
  const token = flareToken(payload);
  if (!token) return null;
  playAnimaFlare(token, payload);
  return playFlareCaption(payload);
}

/** A flare sent by another client: cleaned, then shown if this client should. */
function receiveAnimaFlare(message, { play = playFlare, show = shouldShowFlare } = {}) {
  if (message?.type !== FLARE_MESSAGE) return;
  try {
    const payload = cleanFlarePayload(message.payload);
    if (payload && show(payload)) play(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not play a received anima flare`, err);
  }
}

export {
  ANIMA_LEVELS,
  FLARE_DURATION,
  FLARE_DURATION_GENTLE,
  FLARE_EMBERS,
  FLARE_EMBERS_GENTLE,
  FLARE_HEIGHT,
  FLARE_ICONIC_MAX,
  FLARE_MESSAGE,
  FLARE_RANK,
  FLARE_WIDTH,
  animaAfterUpdate,
  animaBefore,
  animaFlarePayload,
  animaRank,
  changesAnima,
  cleanFlarePayload,
  crossesIntoFlare,
  drawFlare,
  emberLayout,
  flareCaptionMarkup,
  flareFrame,
  flareLevelLabel,
  flareShowing,
  flareToken,
  iconicLine,
  playAnimaFlare,
  playFlare,
  playFlareCaption,
  receiveAnimaFlare,
  recordAnimaBefore,
  shouldShowFlare,
  showingFlare
};
