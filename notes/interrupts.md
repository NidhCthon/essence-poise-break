# Interrupts

## The rule

From Combat Reforged (Storyteller's Guide, p. 75): sides alternate turns, until
one side has no one left to act. A significant character — player characters
included — can **interrupt** the order so their side acts twice in a row. The
character interrupting pays the Power.

The price escalates within the round: **2 Power for the first interrupt, 3 for
the second, and so on**, resetting each round.

One ambiguity worth settling at the table before any code: the text says the
cost rises "each time a side interrupts in a round". That reads either as one
counter shared by the whole battle, or one per side. Shared is harsher and
simpler; per-side is likelier what was meant. Whichever you pick it should be a
setting, not a decision buried in the module.

## What the system gives us

Better than expected in one way and nothing at all in another.

**The turn order is already free-form.** `ExaltedCombat` does not run a fixed
initiative sequence. Every combatant carries `system.acted`, `resetTurnsTaken()`
clears it each round, `toggleTurnOver(id)` marks one done, and the combat is
kept at `turn: null`. It is a "who still has to go" list rather than a running
order — which is exactly the shape alternating sides needs. Nothing has to be
torn out.

**There is no concept of a side.** Nothing in `combat.js`, `combat-tracker.js`
or `combatant.js` mentions factions, sides or disposition. Alternation is not
implemented, so the rule this feature hangs off is not in the system either.

## The scoping decision

This is the part worth deciding before writing anything: **does the module
enforce the alternation, or only price the interrupt?**

Enforcing it means owning turn order — deciding whose side is up, refusing
out-of-turn actions, handling a side that runs out of actors. That is a combat
tracker replacement, and it fights a system that deliberately leaves the order
open.

Pricing it means the table runs the order as it already does, and the module
answers the one question nobody can keep track of: *what does it cost me to go
again right now?*

**Price it.** The escalation is the part that is genuinely hard to remember,
and the alternation is the part a group manages fine by talking. This also
keeps the module in the advisory role it has everywhere else.

## The design

**A side per combatant.** Default from token disposition — friendly and secret
on one side, hostile on the other, neutral asked once — with a per-combatant
override the Storyteller can set, since allied NPCs and turncoats exist.

**A ledger on the combat.** A flag on the Combat document holding interrupts
taken this round, per side:

    flags["essence-poise-break"].interrupts = { friendly: 1, hostile: 0 }

Cleared on `combatRound`. The current price is `2 + count`, where `count` is
the side's own tally or the total, per the setting above.

**A button in the panel.** Shown during combat when the character could go
again: the price, their current Power, and the button — disabled with the
reason when they cannot afford it, are not significant, or the combat is not
running. Pressing it spends the Power, increments the ledger, and announces it
in chat so the table sees who bought the extra turn and what it cost.

**Significance.** Battle groups and extras cannot interrupt. `isBattleGroup()`
already exists; "significant" does not, and there is no field for it. Simplest
honest rule: player characters and any NPC the Storyteller has flagged, with
the flag living on the actor.

## What will make this awkward

- **Players cannot write to the Combat document.** Updating a combat flag needs
  a GM. The system already has a socket for this shape of problem — it relays
  target updates through `system.exaltedessence` — and this would need the same,
  which is the single biggest piece of work in the feature. A GM-only first
  version is a reasonable staging post, but it means a player cannot press
  their own button, which is most of the point.
- **The tally is only as good as the button.** Interrupt by agreement at the
  table without pressing it and the price drifts. Worth showing the tally
  somewhere visible so a wrong number can be corrected rather than trusted.
- **Nothing enforces that it was legal.** Since the module does not own the
  turn order, it cannot know a side had already gone twice. It prices what the
  table says is happening.
- **The rule is draft text.** The Storyteller's Guide is a draft manuscript;
  this is exactly the kind of number that moves before publication. Keep it in
  one constant.

## Smaller than it looks

Stripped to the above, this is: a side per combatant, a counter on the combat,
a price, a button, and a socket so players can use it. The hard half is the
socket, and it is worth doing once because a shared combat ledger is the thing
any future panel feature that spans characters would also need.
