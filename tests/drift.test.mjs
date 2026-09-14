// checkAgainstRoller(): after a roll launched from the panel, compare the
// Defense and Poise the panel predicted with what the roller computed.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { panel, notices, wait } from "./foundry.mjs";

const { TurnPanel } = panel;

const prediction = { targetId: "t1", defense: 5, poise: 3 };
const roller = (defense, targetId = "t1") => ({
  object: { target: { actor: { id: targetId } }, defense, poise: 3 }
});

/** How many times the check warned, for a given game.rollForm. */
async function warningsFor(rollForm) {
  const warn = mock.method(console, "warn", () => {});
  game.rollForm = rollForm;
  TurnPanel.checkAgainstRoller(prediction);
  await wait(750);
  const count = warn.mock.callCount();
  warn.mock.restore();
  return count;
}

test("a disagreement is reported when game.rollForm is the form itself", async () => {
  assert.equal(await warningsFor(roller(2)), 1);
  assert.equal(notices.length, 1, "the first disagreement also notifies the user");
});

test("and when it is the promise render() returns, as the system stores it", async () => {
  // weaponAttack assigns new RollForm(...).render(true). render() is async and
  // RollForm does not override it, so this is a Promise, and reading .object
  // off it found undefined: the check never fired once until it awaited.
  assert.equal(await warningsFor(Promise.resolve(roller(2))), 1);
});

test("the console hears every disagreement, but the user is notified once", () => {
  assert.equal(notices.length, 1);
});

test("matching numbers stay quiet", async () => {
  assert.equal(await warningsFor(roller(5)), 0);
});

test("a roll against someone else is not compared", async () => {
  assert.equal(await warningsFor(roller(0, "someone-else")), 0);
});
