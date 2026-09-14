// The grappler's own -1 Defense, and the race that used to delete it.
//
// The roller snapshots the whole attacker before a gambit, spends the Power
// into that snapshot, and calls actor.update(snapshot) without awaiting.
// Foundry rebuilds an embedded collection from exactly the array it is handed,
// so an effect created after the snapshot is dropped when the write lands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { panel, notices, wait } from "./foundry.mjs";

const { grappleTheAttacker, alreadyGrappling } = panel;

function makeActor() {
  const actor = {
    id: "a1", name: "Rising Tide", type: "character", uuid: "Actor.a1", effects: [],
    async createEmbeddedDocuments(type, docs) {
      actor.effects.push(...docs.map((d) => ({ ...d, statuses: new Set(d.statuses ?? []) })));
    },
    /**
     * A real Document#update validates and round-trips the server before it
     * commits. Commit synchronously and there is nothing to race - the first
     * version of this test did exactly that, and passed against broken code.
     */
    async update(data) {
      await wait(60);
      if (data.effects) actor.effects = data.effects.slice();
      Hooks.callAll("updateActor", actor);
    }
  };
  return actor;
}

/** A gambit roll: snapshot, spend Power without awaiting, then resolve. */
function rollGambit(actor, resolveGambit) {
  const snapshot = { effects: actor.effects.slice() };
  actor.update(snapshot);
  resolveGambit();
}

test("the fake update really races: an effect created straight away is lost", async () => {
  const actor = makeActor();
  rollGambit(actor, () => actor.createEmbeddedDocuments("ActiveEffect",
    [{ name: "Grappling", statuses: ["grappling"] }]));
  await wait(300);
  assert.equal(alreadyGrappling(actor.effects), false,
    "the fake update no longer races, so the next test would prove nothing");
});

test("the panel waits for the roller's write, and the attacker keeps the effect", async () => {
  notices.length = 0;
  const actor = makeActor();
  rollGambit(actor, () => grappleTheAttacker(actor));
  await wait(1700);   // past the survival check at 1.5s
  assert.equal(alreadyGrappling(actor.effects), true);
  assert.deepEqual(notices, []);
});

test("a gambit costing 0 Power fires no update, and the fallback still applies it", async () => {
  const actor = makeActor();
  grappleTheAttacker(actor);
  await wait(1400);
  assert.equal(alreadyGrappling(actor.effects), true);
});

test("a later write that removes it anyway is reported to the user", async () => {
  notices.length = 0;
  const actor = makeActor();
  rollGambit(actor, async () => {
    await grappleTheAttacker(actor);
    actor.effects = [];
  });
  await wait(1900);
  assert.equal(alreadyGrappling(actor.effects), false);
  assert.ok(notices.some((n) => /could not keep Rising Tide in the grapple/.test(n)),
    `no notification; got ${JSON.stringify(notices)}`);
});

test("an attacker already grappling gets no second effect", async () => {
  const actor = makeActor();
  actor.effects.push({ name: "Grappling", statuses: new Set(["grappling"]) });
  rollGambit(actor, () => grappleTheAttacker(actor));
  await wait(400);
  assert.equal(actor.effects.length, 1);
});
