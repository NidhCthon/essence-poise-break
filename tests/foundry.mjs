// Just enough of Foundry for scripts/turn-panel.js to load and render outside
// it. node --test runs each test file in its own process, so every file gets a
// freshly imported module and a fresh copy of this state.
//
// Everything a test needs to steer or inspect is exported: settings, the hooks
// the module registered, what it tried to tell the user.

export const settings = new Map([
  ["exaltedessence.combatReforged", true],
  ["essence-poise-break.explain", true],
  ["essence-poise-break.controlSpells", false],
  ["essence-poise-break.clearGambitEffects", true],
  ["essence-poise-break.autoOpen", true]
]);

export const registered = [];
export const notices = [];
export const hooks = { once: new Map(), on: new Map() };

const listFor = (map, event) => {
  if (!map.has(event)) map.set(event, []);
  return map.get(event);
};

globalThis.Hooks = {
  once(event, fn) { listFor(hooks.once, event).push(fn); },
  on(event, fn) { listFor(hooks.on, event).push(fn); return fn; },
  off(event, fn) {
    const list = hooks.on.get(event) ?? [];
    const at = list.indexOf(fn);
    if (at !== -1) list.splice(at, 1);
  },
  callAll(event, ...args) {
    for (const fn of [...(hooks.on.get(event) ?? [])]) fn(...args);
  }
};

/** Run every handler registered with Hooks.once for an event. */
export async function fireOnce(event, ...args) {
  for (const fn of hooks.once.get(event) ?? []) await fn(...args);
}

const gm = { id: "gm", isGM: true, active: true, isSelf: true };

globalThis.game = {
  settings: {
    register(module, key, options) { registered.push({ module, key, options }); },
    get(module, key) { return settings.get(`${module}.${key}`); }
  },
  system: { id: "exaltedessence", version: "3.1.0" },
  modules: new Map([["essence-poise-break", {}]]),
  user: { ...gm, targets: new Set() },
  users: { activeGM: gm },
  time: { worldTime: 0 },
  combat: null
};
game.users.activeGM = game.user;

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {
        constructor(options = {}) { this.options = options; }
        render() { return Promise.resolve(this); }
      }
    }
  },
  utils: { duplicate: (value) => structuredClone(value) }
};

globalThis.ui = {
  notifications: {
    warn: (message) => notices.push(message),
    error: (message) => notices.push(message),
    info: (message) => notices.push(message)
  }
};
globalThis.CONFIG = {};
globalThis.fromUuid = async () => null;

export const panel = await import(new URL("../scripts/turn-panel.js", import.meta.url));

/** Target a token whose actor is `actor`, or clear the target with null. */
export function target(actor) {
  game.user.targets = new Set(actor ? [{ actor }] : []);
}

/** Wait for real time to pass; the panel's timing code uses real timers. */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Markup to searchable text: tags out, the entities the panel uses decoded. */
export function text(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&minus;/g, "-").replace(/&mdash;/g, "-")
    .replace(/&middot;/g, "·").replace(/&rarr;/g, "->")
    .replace(/&starf;/g, "*").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
