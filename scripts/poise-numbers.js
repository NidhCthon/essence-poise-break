/**
 * Poise & Break - Poise damage numbers.
 */

import { BREAK_COLORS, breakTextStyle, mixColor, photosensitive } from "./break-effect.js";
import { MODULE_ID } from "./core.js";
import { visibleTokens } from "./defeated.js";

/* -------------------------------------------- */
/*  Poise damage numbers                        */
/* -------------------------------------------- */

/**
 * Poise damage numbers: when a token's Poise falls, the amount pops off it in
 * the BREAK text's lettering - jade while they still stand, break red on the
 * hit that Breaks them - and Poise coming back while in Break shows as a paler
 * "+". So a player sees what their withering attack did without reading the
 * chat card.
 *
 * The roller lowers Poise with an ordinary update to the target, which reaches
 * every client, but an update arrives carrying only the new value. So each
 * client remembers the Poise of every token it draws and compares. Nothing is
 * sent, and a change made from the sheet shows the same way as one from a roll.
 */
const POISE_NUMBER_DURATION = 1400;
const POISE_NUMBER_DURATION_GENTLE = 1800;
/** A number's size, in pixels at scene scale: more than a callout, the size of BREAK or more. */
const POISE_NUMBER_SIZE_MIN = 56;
const POISE_NUMBER_SIZE_MAX = 140;
/** Numbers landing on one token close together stack, the newest on top. */
const POISE_NUMBER_STACK = 4;

function showingPoiseNumbers() {
  try {
    return !!game.settings.get(MODULE_ID, "poiseNumbers");
  } catch (err) {
    return false;
  }
}

function poiseNumberSize(radius) {
  return Math.round(Math.min(POISE_NUMBER_SIZE_MAX,
    Math.max(POISE_NUMBER_SIZE_MIN, (Number(radius) || 0) * 1.3)));
}

function poiseValue(actor) {
  const value = Number(actor?.system?.poise?.value);
  return Number.isFinite(value) ? value : null;
}

/** Each actor's Poise as this client last saw it. */
const poiseSeen = new Map();

function rememberPoise(actor) {
  if (!actor?.uuid) return;
  const value = poiseValue(actor);
  if (value !== null) poiseSeen.set(actor.uuid, value);
}

/** Note the Poise of everything on the canvas, as it is drawn. */
function rememberCanvasPoise(board = globalThis.canvas) {
  for (const token of board?.tokens?.placeables ?? []) rememberPoise(token?.actor);
}

/** Does this update set the Poise value, nested or as a flattened key? */
function changesPoise(changes) {
  if (!changes || typeof changes !== "object") return false;
  if (Object.hasOwn(changes, "system.poise.value")) return true;
  const poise = changes.system?.poise;
  return !!poise && typeof poise === "object" && Object.hasOwn(poise, "value");
}

/**
 * What an update did to an actor's Poise: the amount, negative for a loss,
 * and whether it was the hit that Broke them. Null when there is nothing to
 * show - no change, or a Poise this client never saw before. Either way the new
 * value is remembered.
 */
function poiseChange(actor, changes) {
  if (!actor?.uuid || !changesPoise(changes)) return null;
  const before = poiseSeen.get(actor.uuid);
  const after = poiseValue(actor);
  rememberPoise(actor);
  if (before === undefined || after === null || before === after) return null;
  const amount = after - before;
  return { amount, broke: amount < 0 && after <= 0 };
}

/** The number as written: a hyphen, which the carved face certainly has. */
function poiseNumberText({ amount }) {
  return amount > 0 ? `+${amount}` : `-${Math.abs(amount)}`;
}

function poiseNumberColor({ amount, broke }) {
  if (broke) return BREAK_COLORS.break;
  if (amount > 0) return mixColor(BREAK_COLORS.jade, 0xFFFFFF, 0.45);
  return BREAK_COLORS.jade;
}

/** The number at progress t, from 0 to 1. */
function poiseNumberFrame(t, { gentle = false, broke = false } = {}) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  if (gentle) {
    // Photosensitive mode: no pop and no shudder. It fades in, drifts, fades.
    return {
      alpha: p < 0.2 ? p / 0.2 : p > 0.65 ? Math.max(0, (1 - p) / (1 - 0.65)) : 1,
      scale: 1, rise: p * 0.5, drift: 0, shake: 0
    };
  }
  const landing = Math.min(1, p / 0.12);
  const since = Math.max(0, p - 0.12);
  return {
    alpha: p < 0.04 ? p / 0.04 : p > 0.62 ? Math.max(0, (1 - p) / (1 - 0.62)) : 1,
    // Pops out oversized and snaps back; the Breaking hit lands bigger.
    scale: (p < 0.12 ? 1.9 - 0.9 * (1 - (1 - landing) ** 3) : 1) * (broke ? 1.25 : 1),
    // Arcs up and out, easing off.
    rise: 1 - (1 - p) ** 2,
    drift: p,
    shake: broke && since > 0 && since < 0.15 ? Math.sin(since * 150) * (1 - since / 0.15) : 0
  };
}

/** The tokens this client should show a Poise change on. */
function poiseNumberTokens(actor) {
  if (!showingPoiseNumbers() || typeof actor?.getActiveTokens !== "function") return [];
  return visibleTokens(actor.getActiveTokens());
}

/** How many numbers each token is showing now, so a new one stacks above. */
const poiseShowing = new Map();

/**
 * Play one number on a token, above the tokens like BREAK, up and to the
 * right of centre so the BREAK word can land in the middle at the same time.
 */
async function playPoiseNumber(token, change) {
  const pixi = globalThis.PIXI;
  const board = globalThis.canvas;
  const CanvasAnimation = foundry.canvas?.animation?.CanvasAnimation;
  if (!pixi || !board?.interface || !CanvasAnimation || !token?.center || !change) return;
  const radius = Math.max(token.w ?? 0, token.h ?? 0) / 2;
  if (!radius) return;
  const gentle = board.photosensitiveMode === true || photosensitive();
  const size = poiseNumberSize(radius);
  const TextClass = foundry.canvas?.containers?.PreciseText ?? pixi.Text;

  const slot = Math.min(poiseShowing.get(token.id) ?? 0, POISE_NUMBER_STACK - 1);
  poiseShowing.set(token.id, (poiseShowing.get(token.id) ?? 0) + 1);

  const container = new pixi.Container();
  container.eventMode = "none";
  container.zIndex = CONFIG.Canvas?.groups?.interface?.zIndexScrollingText ?? 1100;
  const holder = container.addChild(new pixi.Container());
  const number = holder.addChild(new TextClass(poiseNumberText(change), breakTextStyle(pixi, size)));
  number.anchor.set(0.5, 1);
  const label = holder.addChild(new TextClass("POISE", breakTextStyle(pixi, Math.round(size * 0.34))));
  label.anchor.set(0.5, 0);
  const color = poiseNumberColor(change);
  number.tint = color;
  label.tint = color;
  board.interface.addChild(container);

  const startX = token.center.x + radius * 0.8;
  const startY = token.center.y - radius * 0.35 - slot * size * 1.1;
  const state = { t: 0 };
  const draw = () => {
    if (container.destroyed) return;
    const frame = poiseNumberFrame(state.t, { gentle, broke: change.broke });
    container.alpha = frame.alpha;
    holder.scale.set(frame.scale);
    container.position.set(
      startX + radius * 0.35 * frame.drift + frame.shake * size * 0.08,
      startY - radius * 0.9 * frame.rise
    );
  };

  try {
    draw();
    await CanvasAnimation.animate(
      [{ parent: state, attribute: "t", from: 0, to: 1 }],
      {
        name: `${MODULE_ID}.poise.${token.id}.${Date.now()}.${Math.random()}`,
        context: container,
        duration: gentle ? POISE_NUMBER_DURATION_GENTLE : POISE_NUMBER_DURATION,
        ontick: draw
      }
    );
  } catch (err) {
    console.error(`${MODULE_ID} | could not play the Poise number`, err);
  } finally {
    const left = (poiseShowing.get(token.id) ?? 1) - 1;
    if (left > 0) poiseShowing.set(token.id, left);
    else poiseShowing.delete(token.id);
    if (!container.destroyed) container.destroy({ children: true });
  }
}

/** updateActor, on every client: show what the update did to Poise, if anything. */
function poiseAfterUpdate(actor, changes, { play = playPoiseNumber } = {}) {
  const change = poiseChange(actor, changes);
  if (!change) return null;
  for (const token of poiseNumberTokens(actor)) {
    Promise.resolve(play(token, change)).catch((err) =>
      console.error(`${MODULE_ID} | could not play the Poise number`, err));
  }
  return change;
}

export {
  POISE_NUMBER_DURATION,
  POISE_NUMBER_DURATION_GENTLE,
  POISE_NUMBER_SIZE_MAX,
  POISE_NUMBER_SIZE_MIN,
  POISE_NUMBER_STACK,
  changesPoise,
  playPoiseNumber,
  poiseAfterUpdate,
  poiseChange,
  poiseNumberColor,
  poiseNumberFrame,
  poiseNumberSize,
  poiseNumberText,
  poiseNumberTokens,
  poiseSeen,
  poiseShowing,
  poiseValue,
  rememberCanvasPoise,
  rememberPoise,
  showingPoiseNumbers
};
