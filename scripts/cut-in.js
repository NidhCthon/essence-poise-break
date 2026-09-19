/**
 * Poise & Break - The decisive cut-in, and the hit-stop and screen shake before it.
 */

import { MODULE_ID } from "./core.js";
import { animaColorFor } from "./anima-colors.js";
import { esc } from "./rules.js";
import { photosensitive } from "./break-effect.js";

/* -------------------------------------------- */
/*  The decisive cut-in                         */
/* -------------------------------------------- */

/**
 * The decisive cut-in: when a decisive attack lands, the attacker's portrait
 * slams across every screen in a band of their anima colour, with the Charms
 * they put into the strike.
 *
 * The roll happens on one client, and the Charms added to it live only in that
 * client's roller - nothing about them reaches the chat card. So the roller's
 * own attack-animation step, attackSequence(), is wrapped: it runs first and
 * unchanged, then the rolling client plays the cut-in and sends it to everyone
 * else over the module's socket. Each client decides for itself whether to
 * show it, and nothing is written to any document.
 */
const CUT_IN_SOCKET = `module.${MODULE_ID}`;
const CUT_IN_MESSAGE = "decisiveCutIn";
/** Matched by the animations in styles/cut-in.css. */
const CUT_IN_DURATION = 1600;
const CUT_IN_DURATION_GENTLE = 2200;
/** Charms named on the band; any more are counted. */
const CUT_IN_CHARMS = 3;
/** Orichalcum, the colour this module already gives decisive attacks. */
const CUT_IN_FALLBACK = "#E5B356";
const CUT_IN_PORTRAIT = "icons/svg/mystery-man.svg";

function showingCutIn() {
  try {
    return !!game.settings.get(MODULE_ID, "decisiveCutIn");
  } catch (err) {
    return false;
  }
}

function revealingStorytellerCharms() {
  try {
    return !!game.settings.get(MODULE_ID, "revealStorytellerCharms");
  } catch (err) {
    return false;
  }
}

/**
 * Did this roll land a decisive attack? The roller's own test, at the end of a
 * damage roll: accuracy less Defense below zero misses, and anything else hits
 * - even with no extra successes to spare.
 */
function isDecisiveHit(object) {
  if (object?.rollType !== "decisive") return false;
  const accuracy = Number(object.accuracyResult);
  const defense = Number(object.defense);
  if (!Number.isFinite(accuracy) || !Number.isFinite(defense)) return false;
  return accuracy - defense >= 0;
}

/**
 * The band's colour, from the sheet's anima colour. Only a six-digit hex gets
 * through, since it goes into a style. The system defaults anima to white,
 * which is no colour at all on a band of light, so near-white is orichalcum.
 */
function cutInColor(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (!match) return CUT_IN_FALLBACK;
  const number = parseInt(match[1], 16);
  const channels = [number >> 16, number >> 8, number].map((c) => c & 0xff);
  if (Math.min(...channels) > 225) return CUT_IN_FALLBACK;
  return `#${match[1].toUpperCase()}`;
}

/** A portrait path, or Foundry's silhouette in place of one that could run script. */
function cutInImage(value) {
  const src = typeof value === "string" ? value.trim() : "";
  // Browsers ignore whitespace and control characters inside a URL scheme.
  const scheme = src.replace(/[\s\u0000-\u001f]+/g, "");
  if (!src || /^(?:javascript|vbscript):|^data:(?!image\/)/i.test(scheme)) {
    return CUT_IN_PORTRAIT;
  }
  return src;
}

/**
 * What a cut-in carries, made safe. It arrives over the socket from another
 * client, so every field is untrusted: text is trimmed and capped, the colour
 * and portrait are checked, and anything else is dropped.
 */
function cleanCutInPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const name = text(raw.name, 80);
  if (!name) return null;
  const charms = Array.isArray(raw.charms)
    ? [...new Set(raw.charms.map((charm) => text(charm, 80)).filter(Boolean))].slice(0, 12)
    : [];
  return {
    actorUuid: text(raw.actorUuid, 200) || null,
    tokenId: text(raw.tokenId, 64) || null,
    sceneId: text(raw.sceneId, 64) || null,
    name,
    img: cutInImage(raw.img),
    color: cutInColor(raw.color),
    charms,
    storyteller: raw.storyteller === true
  };
}

/** The cut-in for a roller at the end of its damage roll, or null if it missed. */
function cutInPayload(form) {
  const actor = form?.actor;
  if (!actor || !isDecisiveHit(form.object)) return null;
  let token = null;
  try {
    token = typeof form._getActorToken === "function" ? form._getActorToken() : null;
  } catch (err) {
    token = null;
  }
  // The roller may hand back the token on the canvas or its document.
  const tokenDocument = token?.document ?? token;
  return cleanCutInPayload({
    actorUuid: actor.uuid,
    tokenId: tokenDocument?.id,
    sceneId: tokenDocument?.parent?.id,
    name: actor.name,
    img: actor.img,
    color: animaColorFor(actor),
    charms: (form.object.addedCharms ?? []).map((charm) => charm?.name),
    storyteller: !actor.hasPlayerOwner
  });
}

/** The attacking actor on this client, if it has it. */
function cutInActor(payload) {
  try {
    return payload?.actorUuid ? globalThis.fromUuidSync?.(payload.actorUuid) ?? null : null;
  } catch (err) {
    return null;
  }
}

/**
 * Should this client show the cut-in? On the scene it is looking at, the
 * attacker's token decides: Token#isVisible is false for a token hidden from
 * players and for one outside their vision, and a cut-in would give it away.
 * Anywhere else, only the attacker's owners and the Storyteller see it.
 */
function shouldShowCutIn(payload, user = game.user) {
  if (!payload || !showingCutIn()) return false;
  return canSeeAttacker(payload, user);
}

/** The cut-in's rule for who may see a decisive hit, whether or not it is shown. */
function canSeeAttacker(payload, user = game.user) {
  if (!payload) return false;
  const board = globalThis.canvas;
  if (payload.tokenId && board?.scene?.id && board.scene.id === payload.sceneId) {
    const token = board.tokens?.get?.(payload.tokenId);
    if (token) return !!token.isVisible && !token.destroyed;
  }
  if (user?.isGM) return true;
  return !!cutInActor(payload)?.isOwner;
}

/**
 * The Charms this user is shown. A player's are named for everyone. An
 * antagonist's stay with the Storyteller unless the table chooses to name
 * them, since players may not know what it can do. Who owns the attacker is
 * read from the actor where this client has it, not taken from the message.
 */
function cutInCharms(payload, user = game.user, actor = null) {
  if (!payload?.charms?.length) return [];
  const storyteller = actor ? !actor.hasPlayerOwner : payload.storyteller;
  if (storyteller && !user?.isGM && !revealingStorytellerCharms()) return [];
  return payload.charms;
}

/** The cut-in's markup. Every name in it is escaped. */
function cutInMarkup(payload, { charms = [], gentle = false } = {}) {
  const shown = charms.slice(0, CUT_IN_CHARMS);
  const more = charms.length - shown.length;
  const list = shown.length
    ? `<ul class="epb-cutin-charms">${shown.map((charm) => `<li>${esc(charm)}</li>`).join("")}${
      more > 0 ? `<li class="epb-cutin-more">+${more} more</li>` : ""}</ul>`
    : "";
  return `<div class="epb-cutin" style="--epb-cutin-color: ${cutInColor(payload?.color)}"${
    gentle ? ` data-gentle="true"` : ""} aria-hidden="true">
    <div class="epb-cutin-lines"></div>
    <div class="epb-cutin-band">
      <img class="epb-cutin-portrait" src="${esc(cutInImage(payload?.img))}" alt="">
      <div class="epb-cutin-text">
        <span class="epb-cutin-name">${esc(payload?.name)}</span>
        <span class="epb-cutin-word">Decisive</span>
        ${list}
      </div>
    </div>
  </div>`;
}

/** The cut-in on screen now, so a second replaces it rather than stacking. */
let cutInShowing = null;

/**
 * Put the cut-in on this client's screen, above everything and never in the
 * way of a click, and take it down once it has played. Photosensitive mode
 * and the browser's reduced-motion preference both get the gentle version.
 */
function playCutIn(payload, { doc = globalThis.document, user = game.user } = {}) {
  if (!payload || !doc?.body) return null;
  const reducedMotion = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const gentle = photosensitive() || reducedMotion;
  cutInShowing?.remove();
  const layer = doc.createElement("div");
  layer.className = "epb-cutin-layer";
  layer.innerHTML = cutInMarkup(payload, {
    charms: cutInCharms(payload, user, cutInActor(payload)),
    gentle
  });
  doc.body.append(layer);
  cutInShowing = layer;
  setTimeout(() => {
    layer.remove();
    if (cutInShowing === layer) cutInShowing = null;
  }, gentle ? CUT_IN_DURATION_GENTLE : CUT_IN_DURATION);
  return layer;
}

/**
 * Wrap the roller's attack-animation step. The system's own step runs first
 * and its result is returned untouched; the cut-in comes after, and anything
 * that goes wrong in it is caught, so it can never break a roll.
 */
function wrapAttackSequence(RollForm, {
  emit = (message) => game.socket?.emit(CUT_IN_SOCKET, message),
  play = playDecisive,
  show = shouldShowDecisive
} = {}) {
  const prototype = RollForm?.prototype;
  const original = prototype?.attackSequence;
  if (typeof original !== "function" || original.epbCutIn) return false;
  const wrapped = function (...args) {
    const result = original.apply(this, args);
    let payload = null;
    try {
      payload = cutInPayload(this);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not read the roll for the decisive cut-in`, err);
    }
    if (!payload) return result;
    try {
      emit({ type: CUT_IN_MESSAGE, payload });
    } catch (err) {
      console.warn(`${MODULE_ID} | could not send the decisive cut-in`, err);
    }
    try {
      if (show(payload)) play(payload);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not play the decisive cut-in`, err);
    }
    return result;
  };
  wrapped.epbCutIn = true;
  prototype.attackSequence = wrapped;
  return true;
}

/** A cut-in sent by another client: cleaned, then shown if this client should. */
function receiveCutIn(message, { play = playDecisive, show = shouldShowDecisive } = {}) {
  if (message?.type !== CUT_IN_MESSAGE) return;
  try {
    const payload = cleanCutInPayload(message.payload);
    if (payload && show(payload)) play(payload);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not play a received decisive cut-in`, err);
  }
}

/* -------------------------------------------- */
/*  Hit-stop and screen shake                   */
/* -------------------------------------------- */

/**
 * The impact of a decisive hit, the way fighting games sell one: the map
 * freezes for a split second on a stark, high-contrast frame, then the whole
 * screen jolts and the cut-in slashes in over it.
 *
 * The freeze is real. The canvas's ticker drives everything that moves on the
 * map - token animations, the system's attack effects, the Bonfire aura - so
 * stopping it holds them all mid-motion, and starting it again lets them go.
 * The stark frame and the jolt are CSS on the board's own element
 * (styles/cut-in.css), which leaves the canvas's pan and zoom alone.
 *
 * It rides on the cut-in's message and follows the same rule for who sees it.
 * Photosensitive mode and reduced motion leave it out entirely.
 */
/** How long the map holds still. */
const HIT_STOP = 140;
/** Matched by epb-shake in styles/cut-in.css. */
const SHAKE_DURATION = 420;

function showingImpact() {
  try {
    return !!game.settings.get(MODULE_ID, "hitImpact");
  } catch (err) {
    return false;
  }
}

/** Is the impact for this client: on, and not asked to keep motion down? */
function impactAllowed() {
  const reducedMotion = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  return showingImpact() && !photosensitive() && !reducedMotion;
}

/** Should this client show a decisive hit at all: the cut-in, the impact, or both? */
function shouldShowDecisive(payload, user = game.user) {
  if (!payload || !(showingCutIn() || showingImpact())) return false;
  return canSeeAttacker(payload, user);
}

/**
 * Freeze the map, then shake it. Resolves once the freeze lets go, when the
 * shake begins, or at once with false if there is no board or an impact is
 * already playing. The ticker is started again only if this stopped it, and
 * always, even if something else goes wrong, since a map left frozen would be
 * far worse than a missed shake.
 */
function hitStop({ board = globalThis.canvas, duration = HIT_STOP } = {}) {
  const view = board?.app?.view;
  if (!view?.dataset || view.dataset.epbImpact) return Promise.resolve(false);
  const ticker = board.app.ticker;
  let froze = false;
  try {
    view.dataset.epbImpact = "stop";
    if (ticker?.started && typeof ticker.stop === "function") {
      ticker.stop();
      froze = true;
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | could not freeze the map`, err);
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      try {
        if (froze) ticker.start();
      } catch (err) {
        console.warn(`${MODULE_ID} | could not restart the map`, err);
      }
      view.dataset.epbImpact = "shake";
      setTimeout(() => {
        if (view.dataset.epbImpact === "shake") delete view.dataset.epbImpact;
      }, SHAKE_DURATION);
      resolve(true);
    }, duration);
  });
}

/**
 * A decisive hit on this client: the impact first where it is allowed, then
 * the cut-in where that is on. With no impact the cut-in plays at once.
 */
function playDecisive(payload, {
  impact = impactAllowed,
  stop = hitStop,
  cutIn = playCutIn,
  showCut = showingCutIn
} = {}) {
  if (!payload) return Promise.resolve(false);
  const after = () => {
    try {
      if (showCut()) cutIn(payload);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not play the decisive cut-in`, err);
    }
    return true;
  };
  if (!impact()) return Promise.resolve(after());
  return Promise.resolve(stop()).then(after, after);
}

export {
  CUT_IN_CHARMS,
  CUT_IN_DURATION,
  CUT_IN_DURATION_GENTLE,
  CUT_IN_FALLBACK,
  CUT_IN_MESSAGE,
  CUT_IN_PORTRAIT,
  CUT_IN_SOCKET,
  HIT_STOP,
  SHAKE_DURATION,
  canSeeAttacker,
  cleanCutInPayload,
  cutInActor,
  cutInCharms,
  cutInColor,
  cutInImage,
  cutInMarkup,
  cutInPayload,
  cutInShowing,
  hitStop,
  impactAllowed,
  isDecisiveHit,
  playCutIn,
  playDecisive,
  receiveCutIn,
  revealingStorytellerCharms,
  shouldShowCutIn,
  shouldShowDecisive,
  showingCutIn,
  showingImpact,
  wrapAttackSequence
};
