/**
 * Poise & Break - Poise drawn as shards, and the shatter and BREAK word when a
 * token Breaks.
 */

import { MODULE_ID, effectEnabled } from "./core.js";

/* -------------------------------------------- */
/*  Poise as shards, and the Break effect       */
/* -------------------------------------------- */

/** Past this many, shards stop reading as a count; the number carries it. */
const MAX_SHARDS = 10;

/**
 * Poise as a row of jade shards: full for the Poise left, faint for what has
 * been worn away, and every one of them cracked in Break. The number is always
 * printed beside it as well - the shards are for a glance, not for counting.
 */
function poiseShards(value, max, { broken = false, small = false } = {}) {
  const current = Math.max(0, Number(value) || 0);
  const top = Math.max(Number(max) || 0, current);
  const drawn = Math.min(MAX_SHARDS, top);
  if (!drawn) return "";

  const filled = broken ? 0 : Math.min(drawn, current);
  const shards = Array.from({ length: drawn }, (_, i) =>
    `<span class="epb-shard${i < filled ? " is-full" : ""}" style="--epb-i:${i}"></span>`
  ).join("");
  const label = broken ? `In Break, Poise 0 of ${top}` : `Poise ${current} of ${top}`;
  const classes = ["epb-poise", broken && "is-broken", small && "is-small"]
    .filter(Boolean).join(" ");
  return `<span class="${classes}" role="img" aria-label="${label}">${shards}</span>`;
}

/** Foundry's photosensitive mode, which every animation here follows. */
function photosensitive() {
  try {
    return !!game.settings.get("core", "photosensitiveMode");
  } catch (err) {
    return false;
  }
}

/**
 * The Break effect: the moment a token Breaks, its Poise shatters off it.
 *
 * Purely visual, and local to each client - nothing is written to any
 * document. Every client sees the Break status arrive through
 * createActiveEffect and draws its own copy, so it plays however Break was
 * applied, not only for rolls made from this panel.
 */
const BREAK_COLORS = { jade: 0x63C7A0, break: 0xEE7163 };
const BREAK_SHARDS = 14;
const BREAK_DURATION = 950;

function isBreakEffect(effect) {
  const statuses = effect?.statuses;
  return !!(statuses?.has ? statuses.has("break")
    : Array.isArray(statuses) && statuses.includes("break"));
}

function showingBreakEffect() {
  return effectEnabled("breakEffect");
}

/**
 * The tokens that should shatter for this effect, on this client.
 *
 * Token#isVisible is the gate that matters. It is false for a token hidden
 * from players and for one outside this player's vision, and a shatter drawn
 * there would give away where it is.
 */
function breakEffectTokens(effect) {
  if (!isBreakEffect(effect) || !showingBreakEffect()) return [];
  const actor = effect.parent;
  if (typeof actor?.getActiveTokens !== "function") return [];
  return actor.getActiveTokens().filter((token) => token?.isVisible && !token.destroyed);
}

/** A stable number from a token id, so a token shatters the same way each time. */
function seedFor(id) {
  let hash = 2166136261;
  for (const char of String(id ?? "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A small seedable generator; plenty random for scattering shards. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where the shards sit around a token, in fractions of its radius. Spread
 * evenly with a little jitter, so it reads as one crystal coming apart rather
 * than confetti.
 */
function shardLayout(count, seed) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    angle: (i / count) * Math.PI * 2 + (random() - 0.5) * 0.35,
    length: 0.24 + random() * 0.16,
    width: 0.10 + random() * 0.06,
    spin: (random() - 0.5) * 2.4,
    drift: 0.55 + random() * 0.6
  }));
}

/** The shatter at progress t, from 0 to 1. */
function shatterFrame(t) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  const burst = 1 - (1 - p) ** 3;
  return {
    burst,
    // Whole for a beat, then gone.
    alpha: p < 0.55 ? 1 : Math.max(0, (1 - p) / 0.45),
    // Jade turns red early, so the colour change is the first thing you see.
    tint: Math.min(1, p / 0.35),
    ringScale: 1 + 0.6 * burst,
    // The ring arrives with the crack rather than before it: nothing on the
    // first frame, strongest a fifth of the way in, gone by the end.
    ringAlpha: 0.85 * (p < 0.2 ? p / 0.2 : (1 - p) / 0.8)
  };
}

/** The light a shard passes through as it cracks. */
const CRACK_LIGHT = 0xFFF4E6;

/**
 * A shard's colour as it cracks: jade, to a flash of light, to break red. A
 * straight blend from jade to red passes through a dull grey-brown halfway,
 * which reads as the effect going muddy rather than breaking.
 */
function shardColor(tint, from, to) {
  return tint < 0.5
    ? mixColor(from, CRACK_LIGHT, tint * 2)
    : mixColor(CRACK_LIGHT, to, (tint - 0.5) * 2);
}

/** Blend two 0xRRGGBB colours, channel by channel. */
function mixColor(from, to, amount) {
  const a = Math.min(1, Math.max(0, amount));
  const channel = (shift) => {
    const x = (from >> shift) & 0xff;
    const y = (to >> shift) & 0xff;
    return Math.round(x + (y - x) * a);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * One frame of the shatter, drawn into a PIXI.Graphics with the PIXI 7 API
 * that Foundry 14 bundles. Kept apart from the canvas so the geometry can be
 * tested, and previewed, on its own.
 */
function drawShatter(graphics, layout, frame, radius, from, to) {
  graphics.clear();
  if (frame.ringAlpha > 0) {
    graphics.lineStyle(1 + radius * 0.06 * (1 - frame.burst), to, frame.ringAlpha);
    graphics.drawCircle(0, 0, radius * frame.ringScale);
    graphics.lineStyle(0);
  }
  const color = shardColor(frame.tint, from, to);
  for (const shard of layout) {
    const distance = radius * (0.95 + shard.drift * frame.burst);
    const cx = Math.cos(shard.angle) * distance;
    const cy = Math.sin(shard.angle) * distance;
    const turn = shard.angle + shard.spin * frame.burst;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const long = radius * shard.length;
    const wide = radius * shard.width;
    const points = [[long, 0], [0, wide / 2], [-long * 0.35, 0], [0, -wide / 2]]
      .flatMap(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
    graphics.beginFill(color, frame.alpha);
    graphics.drawPolygon(points);
    graphics.endFill();
  }
}

/**
 * The word BREAK, over the shards.
 *
 * It slams down from nearly twice its size, cracks in two along the same kind
 * of jagged line that splits a panel shard, cools from white-hot to break red,
 * then rises and fades - lingering longer than the shards, long enough to read.
 */
const BREAK_TEXT_DURATION = 1700;
const BREAK_TEXT_DURATION_GENTLE = 2200;
const BREAK_TEXT_IMPACT = 0.14;

/** The word at progress t, from 0 to 1. */
function breakTextFrame(t, { gentle = false } = {}) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  if (gentle) {
    // Photosensitive mode: no slam, no shudder, no flash. It fades in already
    // red, holds, and fades out.
    return {
      alpha: p < 0.2 ? p / 0.2 : p > 0.7 ? Math.max(0, (1 - p) / 0.3) : 1,
      scale: 1,
      shake: 0,
      split: 0,
      tint: 1,
      rise: p > 0.7 ? (0.5 * (p - 0.7)) / (1 - 0.7) : 0
    };
  }
  const landing = Math.min(1, p / BREAK_TEXT_IMPACT);
  const since = Math.max(0, p - BREAK_TEXT_IMPACT);
  const settle = Math.min(1, since / 0.16);
  return {
    alpha: p < 0.06 ? p / 0.06 : p > 0.62 ? Math.max(0, (1 - p) / 0.38) : 1,
    scale: p < BREAK_TEXT_IMPACT ? 1.9 - 0.9 * (1 - (1 - landing) ** 3) : 1,
    // A short shudder from the moment it lands, dying away.
    shake: since > 0 && since < 0.2 ? Math.sin(since * 140) * (1 - since / 0.2) : 0,
    split: 1 - (1 - settle) ** 3,
    tint: Math.min(1, since / 0.18),
    // Divided by (1 - 0.55), not 0.45: in floating point that reaches exactly
    // 1 at the end, where 0.45 lands a hair short.
    rise: p > 0.55 ? (p - 0.55) / (1 - 0.55) : 0
  };
}

/** The word's size, in pixels at scene scale. */
const BREAK_TEXT_SIZE_MIN = 48;
const BREAK_TEXT_SIZE_MAX = 120;

/**
 * Big enough to land as the biggest thing on the map for a moment - and bigger
 * than a Charm callout, since a Break is the bigger event. It first shipped at
 * about two thirds of the token's radius, which the table found too small, so
 * it is now a little over the radius, and still bounded over a huge token.
 */
function breakTextSize(radius) {
  return Math.round(Math.min(BREAK_TEXT_SIZE_MAX,
    Math.max(BREAK_TEXT_SIZE_MIN, (Number(radius) || 0) * 1.2)));
}

/**
 * The mask for one half of the word: from a jagged crack a little off centre,
 * out past the word's edge. Both halves share the crack, so at rest they meet
 * exactly and the word reads whole.
 */
function crackMask(side, width, height) {
  const crack = [[0.07, -0.75], [-0.03, -0.12], [0.05, 0.14], [-0.06, 0.75]]
    .map(([x, y]) => [x * width, y * height]);
  const edge = side * width;
  return [...crack, [edge, 0.75 * height], [edge, -0.75 * height]].flat();
}

function breakTextStyle(pixi, size) {
  const options = {
    fontFamily: "Modesto Condensed",
    fontSize: size,
    fill: 0xFFFFFF,
    stroke: 0x160A08,
    strokeThickness: Math.max(3, Math.round(size * 0.1)),
    letterSpacing: Math.round(size * 0.06),
    align: "center",
    dropShadow: true,
    dropShadowColor: 0x000000,
    dropShadowAlpha: 0.85,
    dropShadowBlur: Math.round(size * 0.25),
    dropShadowDistance: 0,
    dropShadowAngle: 0
  };
  const Precise = foundry.canvas?.containers?.PreciseText;
  return typeof Precise?.getTextStyle === "function"
    ? Precise.getTextStyle(options)
    : new pixi.TextStyle(options);
}

/**
 * Build the word as two copies, each masked to one side of the crack so the
 * halves can come apart. Foundry's PreciseText keeps it sharp at any zoom;
 * plain PIXI text stands in outside Foundry. Returns the container and a
 * function that draws the word at progress t.
 */
function createBreakText(pixi, radius, { gentle = false } = {}) {
  const size = breakTextSize(radius);
  const style = breakTextStyle(pixi, size);
  const TextClass = foundry.canvas?.containers?.PreciseText ?? pixi.Text;

  const root = new pixi.Container();
  root.eventMode = "none";
  const halves = [-1, 1].map((side) => {
    const piece = root.addChild(new pixi.Container());
    const text = piece.addChild(new TextClass("BREAK", style));
    text.anchor.set(0.5, 0.5);
    const mask = piece.addChild(new pixi.Graphics());
    mask.beginFill(0xFFFFFF);
    mask.drawPolygon(crackMask(side, text.width, text.height));
    mask.endFill();
    text.mask = mask;
    return { piece, text, side };
  });

  const update = (t) => {
    const frame = breakTextFrame(t, { gentle });
    root.alpha = frame.alpha;
    root.scale.set(frame.scale);
    root.position.set(frame.shake * size * 0.06, -radius * (0.15 + 0.5 * frame.rise));
    const color = mixColor(CRACK_LIGHT, BREAK_COLORS.break, frame.tint);
    for (const { piece, text, side } of halves) {
      text.tint = color;
      piece.position.set(side * frame.split * size * 0.05, side * frame.split * size * 0.03);
      piece.rotation = side * frame.split * 0.035;
    }
  };
  update(0);
  return { container: root, update, size };
}

/**
 * Foundry floats a small "+(Break)" as the status lands. With the BREAK text
 * playing, that says the same thing twice in the same place, so on a client
 * showing the effect it is skipped - for Break alone, and only as it lands.
 * Every other status, and "-(Break)" as Break ends, is drawn exactly as
 * Foundry draws it. A player with the effect switched off keeps Foundry's.
 */
function quietCoreBreakText() {
  const documentClass = CONFIG.ActiveEffect?.documentClass;
  const original = documentClass?.prototype?._displayScrollingStatus;
  if (typeof original !== "function" || original.epbQuietsBreak) return false;
  const wrapped = function (enabled) {
    if (enabled && isBreakEffect(this) && showingBreakEffect()) return undefined;
    return original.call(this, enabled);
  };
  wrapped.epbQuietsBreak = true;
  documentClass.prototype._displayScrollingStatus = wrapped;
  return true;
}

/**
 * Play the shatter on one token. The drawing lives in the interface canvas
 * group, above the tokens, and is destroyed when the animation ends - or found
 * already destroyed, if the canvas was torn down around it.
 */
async function playBreakEffect(token) {
  const pixi = globalThis.PIXI;
  const board = globalThis.canvas;
  const CanvasAnimation = foundry.canvas?.animation?.CanvasAnimation;
  if (!pixi || !board?.interface || !CanvasAnimation || !token?.center) return;

  const radius = Math.max(token.w ?? 0, token.h ?? 0) / 2;
  if (!radius) return;
  const gentle = board.photosensitiveMode === true || photosensitive();

  // A token with a dynamic ring flashes it red as well. Foundry softens that
  // flash itself in photosensitive mode.
  if (token.hasDynamicRing && token.ring?.flashColor && foundry.utils?.Color) {
    token.ring.flashColor(foundry.utils.Color.from(BREAK_COLORS.break), { duration: 1600 })
      ?.catch?.(() => {});
  }

  const container = new pixi.Container();
  container.eventMode = "none";
  container.position.set(token.center.x, token.center.y);
  const graphics = container.addChild(new pixi.Graphics());
  // The word sits on top of the shards. If it cannot be built for any reason,
  // the shatter still plays without it.
  let label = null;
  try {
    label = createBreakText(pixi, radius, { gentle });
    container.addChild(label.container);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not draw the BREAK text`, err);
  }
  // Above the token layer. The interface group sorts its children by zIndex,
  // and each token draws a void mesh that erases interface content beneath it
  // inside the token's outline. At the default of 0 that hid the word entirely
  // and cut the shards off at the token's edge. Foundry's own floating text sits
  // at this level for the same reason.
  container.zIndex = CONFIG.Canvas?.groups?.interface?.zIndexScrollingText ?? 1100;
  board.interface.addChild(container);

  // Photosensitive mode gets the ring alone, slower and fainter: no burst of
  // shards across the screen.
  const layout = gentle ? [] : shardLayout(BREAK_SHARDS, seedFor(token.id));
  const state = { t: 0 };
  const draw = () => {
    if (graphics.destroyed) return;
    const frame = shatterFrame(state.t);
    if (gentle) frame.ringAlpha *= 0.4;
    drawShatter(graphics, layout, frame, radius, BREAK_COLORS.jade, BREAK_COLORS.break);
  };

  const words = { t: 0 };
  const write = () => {
    if (label && !label.container.destroyed) label.update(words.t);
  };

  try {
    draw();
    write();
    await Promise.all([
      CanvasAnimation.animate(
        [{ parent: state, attribute: "t", from: 0, to: 1 }],
        {
          name: `${MODULE_ID}.break.${token.id}`,
          context: container,
          duration: gentle ? 1600 : BREAK_DURATION,
          ontick: draw
        }
      ),
      label ? CanvasAnimation.animate(
        [{ parent: words, attribute: "t", from: 0, to: 1 }],
        {
          name: `${MODULE_ID}.break-text.${token.id}`,
          context: container,
          duration: gentle ? BREAK_TEXT_DURATION_GENTLE : BREAK_TEXT_DURATION,
          ontick: write
        }
      ) : null
    ]);
  } catch (err) {
    console.error(`${MODULE_ID} | could not play the Break effect`, err);
  } finally {
    if (!container.destroyed) container.destroy({ children: true });
  }
}

export {
  BREAK_COLORS,
  BREAK_DURATION,
  BREAK_SHARDS,
  BREAK_TEXT_DURATION,
  BREAK_TEXT_DURATION_GENTLE,
  BREAK_TEXT_IMPACT,
  BREAK_TEXT_SIZE_MAX,
  BREAK_TEXT_SIZE_MIN,
  CRACK_LIGHT,
  MAX_SHARDS,
  breakEffectTokens,
  breakTextFrame,
  breakTextSize,
  breakTextStyle,
  crackMask,
  createBreakText,
  drawShatter,
  isBreakEffect,
  mixColor,
  photosensitive,
  playBreakEffect,
  poiseShards,
  quietCoreBreakText,
  seedFor,
  seededRandom,
  shardColor,
  shardLayout,
  shatterFrame,
  showingBreakEffect
};
