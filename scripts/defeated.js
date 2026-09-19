/**
 * Poise & Break - The DEFEATED finisher.
 */

import { MODULE_ID, effectEnabled } from "./core.js";
import { breakTextSize, breakTextStyle, mixColor, photosensitive } from "./break-effect.js";

/* -------------------------------------------- */
/*  The DEFEATED finisher                       */
/* -------------------------------------------- */

/**
 * The DEFEATED finisher: when a character is taken out, the world slows and
 * drains of colour, the screen's edges darken, and DEFEATED falls onto their
 * token in the BREAK text's carved lettering - heavier, slower, and sinking
 * rather than rising, because this one is final.
 *
 * The system never marks anyone out on its own, so it plays on whatever the
 * table uses: the system's Incapacitated status (the skull on the token HUD),
 * Foundry's defeated status if something else supplies it, or the defeated
 * toggle in the combat tracker. Those arrive on every client as they happen, so
 * nothing is sent; each client plays it for the tokens its player can see.
 * Doing two of them at once - the tracker toggle and the skull, say - plays it
 * once.
 *
 * The slow motion is real, like the hit-stop's freeze: the canvas ticker's
 * speed is what every canvas animation measures time by, so lowering it slows
 * tokens moving and effects playing. The word keeps its own clock, so it lands
 * at full weight in the slowed world.
 */
const DEFEAT_STATUSES = ["incapacitated", "dead"];
/** The word, and the drain round it. Matched by styles/finisher.css. */
const DEFEAT_DURATION = 2600;
/** How long the world runs slow, and how slow. */
const DEFEAT_SLOW = 1400;
const DEFEAT_SLOW_SPEED = 0.3;
/** A token plays it once in this long, however many ways it was marked. */
const DEFEAT_REPEAT = 8000;
const DEFEAT_ASH = 0xB9B2A5;

function showingFinisher() {
  return effectEnabled("defeatedFinisher");
}

function hasStatus(effect, ids) {
  const statuses = effect?.statuses;
  if (statuses?.has) return ids.some((id) => statuses.has(id));
  return Array.isArray(statuses) && ids.some((id) => statuses.includes(id));
}

/** The statuses that take a character out: the system's, and Foundry's own. */
function defeatStatuses() {
  const core = CONFIG.specialStatusEffects?.DEFEATED;
  return core && !DEFEAT_STATUSES.includes(core) ? [...DEFEAT_STATUSES, core] : DEFEAT_STATUSES;
}

function isDefeatEffect(effect) {
  return hasStatus(effect, defeatStatuses());
}

function visibleTokens(tokens) {
  return (tokens ?? []).filter((token) => token?.isVisible && !token.destroyed);
}

/** The tokens this client should play it on as a status that takes them out lands. */
function defeatEffectTokens(effect) {
  if (!isDefeatEffect(effect) || !showingFinisher()) return [];
  const actor = effect.parent;
  if (typeof actor?.getActiveTokens !== "function") return [];
  return visibleTokens(actor.getActiveTokens());
}

/** The tokens to play it on as the combat tracker marks a combatant defeated. */
function defeatCombatantTokens(combatant, changed) {
  if (changed?.defeated !== true || !showingFinisher()) return [];
  return visibleTokens([combatant?.token?.object]);
}

/** When each token last played it, so two markings in a row play it once. */
const defeatedAt = new Map();

function firstDefeat(token, now = Date.now()) {
  if (!token?.id) return false;
  const last = defeatedAt.get(token.id);
  if (last !== undefined && now - last < DEFEAT_REPEAT) return false;
  defeatedAt.set(token.id, now);
  return true;
}

/** The word at progress t, from 0 to 1. */
function defeatTextFrame(t, { gentle = false } = {}) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  if (gentle) {
    // Photosensitive mode: already ash, fades in where it rests, holds, fades.
    return {
      alpha: p < 0.2 ? p / 0.2 : p > 0.75 ? Math.max(0, (1 - p) / (1 - 0.75)) : 1,
      scale: 1, stretch: 1, shake: 0, tint: 1, sink: 0
    };
  }
  const impact = 0.12;
  const since = Math.max(0, p - impact);
  const landing = Math.min(1, p / impact);
  return {
    alpha: p < 0.04 ? p / 0.04 : p > 0.78 ? Math.max(0, (1 - p) / (1 - 0.78)) : 1,
    // Falls from well over twice its size, gathering speed, and lands hard.
    scale: p < impact ? 2.4 - 1.4 * landing ** 2 : 1,
    // Then slowly spreads as it holds.
    stretch: 1 + 0.08 * Math.min(1, since / (1 - impact)),
    shake: since > 0 && since < 0.12 ? Math.sin(since * 160) * (1 - since / 0.12) : 0,
    tint: Math.min(1, since / 0.25),
    // And sinks as it goes, rather than rising like BREAK.
    sink: p > 0.7 ? (p - 0.7) / (1 - 0.7) : 0
  };
}

/** Build the word, whole, in the BREAK text's lettering. */
function createDefeatText(pixi, radius, { gentle = false } = {}) {
  const size = breakTextSize(radius);
  const TextClass = foundry.canvas?.containers?.PreciseText ?? pixi.Text;
  const root = new pixi.Container();
  root.eventMode = "none";
  const text = root.addChild(new TextClass("DEFEATED", breakTextStyle(pixi, size)));
  text.anchor.set(0.5, 0.5);
  const update = (t) => {
    const frame = defeatTextFrame(t, { gentle });
    root.alpha = frame.alpha;
    root.scale.set(frame.scale * frame.stretch, frame.scale);
    root.position.set(frame.shake * size * 0.07, -radius * 0.1 + radius * 0.35 * frame.sink);
    text.tint = mixColor(0xFFFFFF, DEFEAT_ASH, frame.tint);
  };
  update(0);
  return { container: root, update, size };
}

/**
 * Slow the world for a moment. Only a ticker running at normal speed is
 * slowed, and it is put back only if nothing else has changed it since, so
 * two finishers together, or anything else that sets the speed, are left
 * alone. Returns whether it slowed.
 */
function slowMotion({ board = globalThis.canvas, duration = DEFEAT_SLOW, speed = DEFEAT_SLOW_SPEED } = {}) {
  const ticker = board?.app?.ticker;
  if (!ticker || ticker.speed !== 1) return false;
  ticker.speed = speed;
  setTimeout(() => {
    if (ticker.speed === speed) ticker.speed = 1;
  }, duration);
  return true;
}

/**
 * Drain the screen: the board goes grey and dim, and a vignette closes in
 * round the edges. Both are taken down after, whatever happens.
 */
function drainScreen({ board = globalThis.canvas, doc = globalThis.document, duration = DEFEAT_DURATION } = {}) {
  const view = board?.app?.view;
  let vignette = null;
  if (view?.dataset) view.dataset.epbDefeat = "true";
  if (doc?.body) {
    vignette = doc.createElement("div");
    vignette.className = "epb-defeat-vignette";
    vignette.setAttribute("aria-hidden", "true");
    doc.body.append(vignette);
  }
  setTimeout(() => {
    if (view?.dataset) delete view.dataset.epbDefeat;
    vignette?.remove();
  }, duration);
  return { view, vignette };
}

/**
 * Play the finisher on one token: the word on the canvas at the token, above
 * the tokens like BREAK, and - unless photosensitive mode or reduced motion
 * asks otherwise - the slow motion and the drain.
 */
async function playDefeat(token) {
  const pixi = globalThis.PIXI;
  const board = globalThis.canvas;
  if (!pixi || !board?.interface || !token?.center) return;
  const radius = Math.max(token.w ?? 0, token.h ?? 0) / 2;
  if (!radius) return;
  const reducedMotion = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const gentle = board.photosensitiveMode === true || photosensitive() || reducedMotion;

  if (!gentle) {
    try {
      slowMotion({ board });
      drainScreen({ board });
    } catch (err) {
      console.warn(`${MODULE_ID} | could not slow and drain the screen`, err);
    }
  }

  const container = new pixi.Container();
  container.eventMode = "none";
  container.position.set(token.center.x, token.center.y);
  container.zIndex = CONFIG.Canvas?.groups?.interface?.zIndexScrollingText ?? 1100;
  let label;
  try {
    label = createDefeatText(pixi, radius, { gentle });
    container.addChild(label.container);
    board.interface.addChild(container);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not draw the DEFEATED text`, err);
    if (!container.destroyed) container.destroy({ children: true });
    return;
  }

  // Its own clock, not the ticker's speed: the world slows, the word does not.
  const ticker = board.app?.ticker;
  const clock = () => globalThis.performance?.now?.() ?? Date.now();
  const started = clock();
  await new Promise((resolve) => {
    let finished = false;
    let tick = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        if (tick) ticker?.remove?.(tick);
      } catch (err) {
        // The canvas's ticker went with the canvas.
      }
      resolve();
    };
    tick = () => {
      const t = (clock() - started) / DEFEAT_DURATION;
      if (container.destroyed || label.container.destroyed) return finish();
      label.update(t);
      if (t >= 1) finish();
    };
    if (ticker?.add) ticker.add(tick);
    // Whether or not the ticker runs, it is over once its time is up.
    setTimeout(finish, DEFEAT_DURATION + 100);
  });
  if (!container.destroyed) container.destroy({ children: true });
}

/** Play it on each token that has not just played it. */
function playDefeats(tokens) {
  for (const token of tokens ?? []) {
    if (!firstDefeat(token)) continue;
    playDefeat(token).catch((err) => console.error(`${MODULE_ID} | could not play the DEFEATED finisher`, err));
  }
}

export {
  DEFEAT_ASH,
  DEFEAT_DURATION,
  DEFEAT_REPEAT,
  DEFEAT_SLOW,
  DEFEAT_SLOW_SPEED,
  DEFEAT_STATUSES,
  createDefeatText,
  defeatCombatantTokens,
  defeatEffectTokens,
  defeatStatuses,
  defeatTextFrame,
  defeatedAt,
  drainScreen,
  firstDefeat,
  hasStatus,
  isDefeatEffect,
  playDefeat,
  playDefeats,
  showingFinisher,
  slowMotion,
  visibleTokens
};
