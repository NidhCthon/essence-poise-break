// The ROUND 1, FIGHT! splash: when a combat update starts the fight for this
// client, and what goes on the screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, settings } from "./foundry.mjs";

const {
  splashedCombats, startsFight, splashMarkup, playSplash, SPLASH_DURATION
} = panel;

const board = { scene: { id: "here" } };
const combat = (id = "c1", sceneId = "here") => ({ id, scene: sceneId ? { id: sceneId } : null });

test("reaching round one starts the fight, once", () => {
  splashedCombats.clear();
  assert.equal(startsFight(combat(), { round: 1, turn: 0 }, { board }), true);
  assert.equal(startsFight(combat(), { round: 1 }, { board }), false, "stepping back to round one");
  assert.equal(startsFight(combat("c2"), { round: 1 }, { board }), true, "another fight has its own");
});

test("later rounds, turns and other changes do not", () => {
  splashedCombats.clear();
  assert.equal(startsFight(combat(), { round: 2 }, { board }), false);
  assert.equal(startsFight(combat(), { turn: 1 }, { board }), false);
  assert.equal(startsFight(combat(), { active: true }, { board }), false);
  assert.equal(startsFight(combat(), null, { board }), false);
  assert.equal(startsFight({ scene: null }, { round: 1 }, { board }), false, "a combat with no id");
});

test("a combat reset to round zero may play it again", () => {
  splashedCombats.clear();
  assert.equal(startsFight(combat(), { round: 1 }, { board }), true);
  assert.equal(startsFight(combat(), { round: 0 }, { board }), false);
  assert.equal(startsFight(combat(), { round: 1 }, { board }), true);
});

test("only on the scene the fight is on, or anywhere for a fight tied to none", () => {
  splashedCombats.clear();
  assert.equal(startsFight(combat("away", "elsewhere"), { round: 1 }, { board }), false);
  assert.equal(startsFight(combat("global", null), { round: 1 }, { board }), true);
});

test("with the setting off it does not play, and does not wait to", () => {
  splashedCombats.clear();
  settings.set("essence-poise-break.roundSplash", false);
  assert.equal(startsFight(combat(), { round: 1 }, { board }), false);
  settings.set("essence-poise-break.roundSplash", true);
  assert.equal(startsFight(combat(), { round: 1 }, { board }), false,
    "a fight already under way should not splash when the setting is turned back on");
});

test("the markup carries ROUND 1 and FIGHT!, and marks the gentle version", () => {
  const html = splashMarkup();
  assert.match(html, /class="epb-splash-round">Round 1</);
  assert.match(html, /class="epb-splash-fight">Fight!</);
  assert.doesNotMatch(html, /data-gentle/);
  assert.match(splashMarkup({ gentle: true }), /data-gentle="true"/);
  assert.match(html, /aria-hidden="true"/);
});

function fakeDocument() {
  const body = {
    children: [],
    append(el) { this.children.push(el); el.parentNode = this; }
  };
  return {
    body,
    createElement: () => ({
      className: "", innerHTML: "",
      remove() { body.children.splice(body.children.indexOf(this), 1); }
    })
  };
}

test("it goes on screen, replaces one already showing, and comes down", async () => {
  const doc = fakeDocument();
  const first = playSplash({ doc });
  assert.equal(first.className, "epb-splash-layer");
  assert.match(first.innerHTML, /FIGHT|Fight!/);
  const second = playSplash({ doc });
  assert.deepEqual(doc.body.children, [second], "a second splash stacked on the first");
  assert.ok(SPLASH_DURATION >= 2000 && SPLASH_DURATION <= 3000);
});

test("photosensitive mode or reduced motion get the gentle version", () => {
  const doc = fakeDocument();
  settings.set("core.photosensitiveMode", true);
  assert.match(playSplash({ doc }).innerHTML, /data-gentle="true"/);
  settings.delete("core.photosensitiveMode");
  globalThis.matchMedia = () => ({ matches: true });
  assert.match(playSplash({ doc }).innerHTML, /data-gentle="true"/);
  delete globalThis.matchMedia;
  assert.doesNotMatch(playSplash({ doc }).innerHTML, /data-gentle/);
  assert.equal(playSplash({ doc: {} }), null);
});
