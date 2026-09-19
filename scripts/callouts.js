/**
 * Poise & Break - Charm callouts and gambit callouts.
 */

import { CRACK_LIGHT, breakTextStyle, mixColor, photosensitive } from "./break-effect.js";
import { CUT_IN_FALLBACK, CUT_IN_SOCKET, cleanCutInPayload, cutInActor, cutInCharms, cutInColor } from "./cut-in.js";
import { GAMBITS } from "./rules.js";
import { MODULE_ID, effectEnabled } from "./core.js";
import { animaColorFor } from "./anima-colors.js";
import { flareToken } from "./anima-flare.js";

/* -------------------------------------------- */
/*  Charm callouts                              */
/* -------------------------------------------- */

/**
 * Charm callouts: the moment a character uses a Charm, its name bursts from
 * their token in the carved lettering of the BREAK text, one name above
 * another when several go together.
 *
 * A Charm is used in one of two places, and each is wrapped the way the cut-in
 * wraps attackSequence - the system's own step runs unchanged, and nothing
 * that goes wrong here can reach it:
 *
 * - In a roll, the roller pays for the Charms added to it in
 *   _updateRollerResources(): when the dice are rolled, and again after a
 *   damage roll. Each roller calls a Charm out once.
 * - From the sheet, the actor's spendItem() pays for one. Only a Charm being
 *   used is called out; spendItem on an active Charm switches it off.
 *
 * The client that used the Charm plays the callout and sends it to everyone
 * else over the module's socket. As in the cut-in, an antagonist's Charm names
 * stay with the Storyteller unless the table chooses to name them.
 */
const CALLOUT_MESSAGE = "charmCallout";
const CALLOUT_DURATION = 1500;
const CALLOUT_DURATION_GENTLE = 2200;
/** How long after one name the next bursts out. */
const CALLOUT_STAGGER = 260;
/** Names called out together; any more are counted in a last line. */
const CALLOUT_MAX = 4;
/** The Charms a roller has already called out, so its second payment is quiet. */
const CALLED_OUT = Symbol("epbCalledOut");

function showingCallouts() {
  return effectEnabled("charmCallouts");
}

/** The names of the Charms among some items, trimmed and each once. */
function calloutNames(items) {
  if (!Array.isArray(items)) return [];
  return [...new Set(items
    .filter((item) => !item?.type || item.type === "charm")
    .map((item) => (typeof item?.name === "string" ? item.name.trim() : ""))
    .filter(Boolean))];
}

/** A callout for an actor's token, or null with no names or no token to call from. */
function calloutPayload(actor, token, names) {
  if (!actor || !names?.length) return null;
  const tokenDocument = token?.document ?? token;
  const payload = cleanCutInPayload({
    actorUuid: actor.uuid,
    tokenId: tokenDocument?.id,
    sceneId: tokenDocument?.parent?.id,
    name: actor.name,
    img: actor.img,
    color: animaColorFor(actor),
    charms: names,
    storyteller: !actor.hasPlayerOwner
  });
  return payload?.tokenId && payload.sceneId && payload.charms.length ? payload : null;
}

/** The callout for a roller paying for its Charms: only those it has not called out. */
function rollerCallout(form) {
  const actor = form?.actor;
  const charms = (form?.object?.addedCharms ?? [])
    .filter((item) => !item?.type || item.type === "charm");
  if (!actor || !charms.length) return null;
  const already = form[CALLED_OUT] ?? (form[CALLED_OUT] = new Set());
  const fresh = charms.filter((charm) => {
    const key = charm?.id ?? charm?._id ?? charm?.name;
    if (!key || already.has(key)) return false;
    already.add(key);
    return true;
  });
  if (!fresh.length) return null;
  let token = null;
  try {
    token = typeof form._getActorToken === "function" ? form._getActorToken() : null;
  } catch (err) {
    token = null;
  }
  return calloutPayload(actor, token, calloutNames(fresh));
}

/** The callout for a Charm used from the sheet. On an active Charm, spendItem switches it off. */
function sheetCallout(actor, item) {
  if (item?.type !== "charm" || item.system?.active) return null;
  let token = null;
  try {
    token = actor?.token ?? actor?.getActiveTokens?.()?.[0] ?? null;
  } catch (err) {
    token = null;
  }
  return calloutPayload(actor, token, calloutNames([item]));
}

/** Only for a token this client can see, on the scene it is viewing. */
function shouldShowCallouts(payload) {
  if (!payload || !showingCallouts()) return false;
  const token = flareToken(payload);
  return !!token && !!token.isVisible && !token.destroyed;
}

/** Send to everyone else and play here, each step caught on its own. */
function sendCallouts(payload, { emit, play, show }) {
  if (!payload) return;
  try {
    emit({ type: CALLOUT_MESSAGE, payload });
  } catch (err) {
    console.warn(`${MODULE_ID} | could not send a Charm callout`, err);
  }
  try {
    if (show(payload)) play(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not play a Charm callout`, err);
  }
}

const emitOnSocket = (message) => game.socket?.emit(CUT_IN_SOCKET, message);

/** Wrap the roller's payment for a roll. Its own step runs first, and its result is returned. */
function wrapRollerResources(RollForm, {
  emit = emitOnSocket, play = playCallouts, show = shouldShowCallouts
} = {}) {
  const prototype = RollForm?.prototype;
  const original = prototype?._updateRollerResources;
  if (typeof original !== "function" || original.epbCallouts) return false;
  const wrapped = function (...args) {
    const result = original.apply(this, args);
    let payload = null;
    try {
      payload = rollerCallout(this);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not read the roll for Charm callouts`, err);
    }
    sendCallouts(payload, { emit, play, show });
    return result;
  };
  wrapped.epbCallouts = true;
  prototype._updateRollerResources = wrapped;
  return true;
}

/**
 * Wrap the actor's spending of one item. Whether the Charm is being used is
 * read before the system runs, since it may switch the Charm on; an error the
 * system itself throws still reaches whoever called it.
 */
function wrapSpendItem(ActorClass, {
  emit = emitOnSocket, play = playCallouts, show = shouldShowCallouts
} = {}) {
  const prototype = ActorClass?.prototype;
  const original = prototype?.spendItem;
  if (typeof original !== "function" || original.epbCallouts) return false;
  const wrapped = function (item, ...rest) {
    let payload = null;
    try {
      payload = sheetCallout(this, item);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not read the Charm for a callout`, err);
    }
    const result = original.call(this, item, ...rest);
    sendCallouts(payload, { emit, play, show });
    return result;
  };
  wrapped.epbCallouts = true;
  prototype.spendItem = wrapped;
  return true;
}

/** One name at progress t, from 0 to 1. */
function calloutFrame(t, { gentle = false } = {}) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  if (gentle) {
    // Photosensitive mode: no burst. It fades in where it rests, then out.
    return {
      alpha: p < 0.25 ? p / 0.25 : p > 0.7 ? Math.max(0, (1 - p) / (1 - 0.7)) : 1,
      scale: 1,
      rise: p > 0.7 ? (p - 0.7) / (1 - 0.7) : 0,
      tint: 1
    };
  }
  const landing = Math.min(1, p / 0.14);
  return {
    alpha: p < 0.06 ? p / 0.06 : p > 0.68 ? Math.max(0, (1 - p) / (1 - 0.68)) : 1,
    scale: p < 0.14 ? 1.7 - 0.7 * (1 - (1 - landing) ** 3) : 1,
    rise: p > 0.55 ? (p - 0.55) / (1 - 0.55) : 0,
    tint: Math.min(1, p / 0.2)
  };
}

/** The lines to call out: the first few names, and a count of the rest. */
function calloutLines(names) {
  const shown = names.slice(0, CALLOUT_MAX);
  const more = names.length - shown.length;
  return more > 0 ? [...shown, `+${more} more`] : shown;
}

/** A name's size, in pixels at scene scale. */
const CALLOUT_SIZE_MIN = 30;
const CALLOUT_SIZE_MAX = 68;

/**
 * Big enough to read at a glance with the map zoomed out - the first size,
 * about a third of the token's radius, was too small to read at the table -
 * and still bounded over a very large token.
 */
function calloutSize(radius) {
  return Math.round(Math.min(CALLOUT_SIZE_MAX,
    Math.max(CALLOUT_SIZE_MIN, (Number(radius) || 0) * 0.7)));
}

/**
 * Where each line is, elapsed ms into the callout: staggered in time, stacked
 * upward from just above the token, each rising a little as it fades.
 */
function calloutLayout(elapsed, count, { gentle = false, radius, size, hue }) {
  const duration = gentle ? CALLOUT_DURATION_GENTLE : CALLOUT_DURATION;
  return Array.from({ length: count }, (_, i) => {
    const frame = calloutFrame((elapsed - i * CALLOUT_STAGGER) / duration, { gentle });
    return {
      alpha: frame.alpha,
      scale: frame.scale,
      tint: mixColor(CRACK_LIGHT, hue, 0.55 * frame.tint),
      x: 0,
      y: -radius * (1.05 + 0.2 * frame.rise) - size * 1.15 * i
    };
  });
}

/**
 * Call out some lines over one token, at Foundry's floating-text level like
 * the BREAK text, and destroy them when done. A second callout on the same
 * token replaces the first.
 */
async function playCalloutsOnToken(token, lines, color) {
  const pixi = globalThis.PIXI;
  const board = globalThis.canvas;
  const CanvasAnimation = foundry.canvas?.animation?.CanvasAnimation;
  if (!pixi || !board?.interface || !CanvasAnimation || !token?.center || !lines?.length) return;

  const radius = Math.max(token.w ?? 0, token.h ?? 0) / 2;
  if (!radius) return;
  const gentle = board.photosensitiveMode === true || photosensitive();
  const hue = parseInt(cutInColor(color).slice(1), 16);
  const size = calloutSize(radius);
  const style = breakTextStyle(pixi, size);
  const TextClass = foundry.canvas?.containers?.PreciseText ?? pixi.Text;

  const container = new pixi.Container();
  container.eventMode = "none";
  container.position.set(token.center.x, token.center.y);
  container.zIndex = CONFIG.Canvas?.groups?.interface?.zIndexScrollingText ?? 1100;
  const labels = lines.map((line) => {
    const text = container.addChild(new TextClass(line, style));
    text.anchor.set(0.5, 1);
    return text;
  });
  board.interface.addChild(container);

  const duration = gentle ? CALLOUT_DURATION_GENTLE : CALLOUT_DURATION;
  const total = duration + (labels.length - 1) * CALLOUT_STAGGER;
  const state = { t: 0 };
  const draw = () => {
    if (container.destroyed) return;
    const layout = calloutLayout(state.t * total, labels.length, { gentle, radius, size, hue });
    labels.forEach((text, i) => {
      if (text.destroyed) return;
      text.alpha = layout[i].alpha;
      text.scale.set(layout[i].scale);
      text.tint = layout[i].tint;
      text.position.set(layout[i].x, layout[i].y);
    });
  };

  try {
    draw();
    await CanvasAnimation.animate(
      [{ parent: state, attribute: "t", from: 0, to: 1 }],
      {
        name: `${MODULE_ID}.callout.${token.id}`,
        context: container,
        duration: total,
        ontick: draw
      }
    );
  } catch (err) {
    console.error(`${MODULE_ID} | could not play the Charm callout`, err);
  } finally {
    if (!container.destroyed) container.destroy({ children: true });
  }
}

/** A callout on this client: the names this user may see, over the token. */
function playCallouts(payload, { user = game.user } = {}) {
  const token = flareToken(payload);
  if (!token) return null;
  const names = cutInCharms(payload, user, cutInActor(payload));
  if (!names.length) return null;
  return playCalloutsOnToken(token, calloutLines(names), payload.color);
}

/** A callout sent by another client: cleaned, then shown if this client should. */
function receiveCallouts(message, { play = playCallouts, show = shouldShowCallouts } = {}) {
  if (message?.type !== CALLOUT_MESSAGE) return;
  try {
    const clean = cleanCutInPayload(message.payload);
    const payload = clean?.tokenId && clean.sceneId && clean.charms.length ? clean : null;
    if (payload && show(payload)) play(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not play a received Charm callout`, err);
  }
}

/* -------------------------------------------- */
/*  Gambit callouts                             */
/* -------------------------------------------- */

/**
 * Gambit callouts: when a gambit lands, its name bursts from the attacker's
 * token the way a Charm's does - "DISARM!", "KNOCKBACK!" - in orichalcum, the
 * colour this module gives gambits, rather than the character's anima.
 *
 * The roller resolves a gambit in _resolveGambit(), which it calls only when
 * the gambit lands against a target, so that step is wrapped: it runs first
 * and unchanged, then the rolling client plays the callout and sends it to
 * everyone else. A gambit is something the whole table sees happen, so unlike a
 * Charm's, an antagonist's is named for everyone.
 */
const GAMBIT_MESSAGE = "gambitCallout";

function showingGambitCallouts() {
  return effectEnabled("gambitCallouts");
}

/** A gambit's name: the panel's own, the system's, or its key made readable. */
function gambitName(key) {
  if (typeof key !== "string" || !key.trim() || key === "none") return "";
  const row = GAMBITS.find((gambit) => gambit.key === key);
  if (row) return row.name;
  const label = CONFIG.EXALTEDESSENCE?.gambits?.[key];
  let localized = "";
  try {
    localized = label ? game.i18n?.localize?.(label) ?? "" : "";
  } catch (err) {
    localized = "";
  }
  if (localized && localized !== label) return localized;
  return key.trim().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The line as called out. */
function gambitCalloutLine(name) {
  return `${String(name ?? "").toUpperCase()}!`;
}

/** The callout for a roller whose gambit has just landed, or null. */
function gambitCallout(form) {
  const actor = form?.actor;
  const name = gambitName(form?.object?.gambit);
  if (!actor || !name) return null;
  let token = null;
  try {
    token = typeof form._getActorToken === "function" ? form._getActorToken() : null;
  } catch (err) {
    token = null;
  }
  return calloutPayload(actor, token, [name]);
}

/** Only for a token this client can see, on the scene it is viewing. */
function shouldShowGambitCallout(payload) {
  if (!payload || !showingGambitCallouts()) return false;
  const token = flareToken(payload);
  return !!token && !!token.isVisible && !token.destroyed;
}

/** The callout on this client, over the attacker's token. */
function playGambitCallout(payload) {
  const token = flareToken(payload);
  const name = payload?.charms?.[0];
  if (!token || !name) return null;
  return playCalloutsOnToken(token, [gambitCalloutLine(name)], CUT_IN_FALLBACK);
}

/** Wrap the roller's resolving of a gambit. Its own step runs first, and its result is returned. */
function wrapResolveGambit(RollForm, {
  emit = emitOnSocket, play = playGambitCallout, show = shouldShowGambitCallout
} = {}) {
  const prototype = RollForm?.prototype;
  const original = prototype?._resolveGambit;
  if (typeof original !== "function" || original.epbGambitCallout) return false;
  const wrapped = function (...args) {
    const result = original.apply(this, args);
    let payload = null;
    try {
      payload = gambitCallout(this);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not read the roll for a gambit callout`, err);
    }
    if (!payload) return result;
    try {
      emit({ type: GAMBIT_MESSAGE, payload });
    } catch (err) {
      console.warn(`${MODULE_ID} | could not send a gambit callout`, err);
    }
    try {
      if (show(payload)) play(payload);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not play a gambit callout`, err);
    }
    return result;
  };
  wrapped.epbGambitCallout = true;
  prototype._resolveGambit = wrapped;
  return true;
}

/** A gambit callout sent by another client: cleaned, then shown if this client should. */
function receiveGambitCallout(message, { play = playGambitCallout, show = shouldShowGambitCallout } = {}) {
  if (message?.type !== GAMBIT_MESSAGE) return;
  try {
    const payload = cleanCutInPayload(message.payload);
    if (payload?.charms?.length && show(payload)) play(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not play a received gambit callout`, err);
  }
}

export {
  CALLED_OUT,
  CALLOUT_DURATION,
  CALLOUT_DURATION_GENTLE,
  CALLOUT_MAX,
  CALLOUT_MESSAGE,
  CALLOUT_SIZE_MAX,
  CALLOUT_SIZE_MIN,
  CALLOUT_STAGGER,
  GAMBIT_MESSAGE,
  calloutFrame,
  calloutLayout,
  calloutLines,
  calloutNames,
  calloutPayload,
  calloutSize,
  emitOnSocket,
  gambitCallout,
  gambitCalloutLine,
  gambitName,
  playCallouts,
  playCalloutsOnToken,
  playGambitCallout,
  receiveCallouts,
  receiveGambitCallout,
  rollerCallout,
  sendCallouts,
  sheetCallout,
  shouldShowCallouts,
  shouldShowGambitCallout,
  showingCallouts,
  showingGambitCallouts,
  wrapResolveGambit,
  wrapRollerResources,
  wrapSpendItem
};
