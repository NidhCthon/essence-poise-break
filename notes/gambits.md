# The gambit picker

The panel gave every weapon a **Gambit** button that opened the roller and
stopped there. Which gambit, and what it costs, was left to the player to
remember — nine of them, with costs from 2 to 5 Power, two of which change
depending on the weapon in your hand.

## What the system already does

Before building anything, it was worth reading what the system has. Quite a
lot, as it turns out:

- `CONFIG.EXALTEDESSENCE.gambits` fills a dropdown in the roller with all nine.
- `myFormHandler` sets `powerSpent` from a cost table of its own.
- A **smashing** weapon takes 1 off Knockback and Knockdown; a **flexible** one
  takes 1 off Ensnare.
- With Combat Reforged on, `grapple` is added to the dropdown.

So the panel does not reimplement gambits. It names them, prices them, and
opens the roller with the gambit already chosen.

## Why the cost has to be duplicated anyway

The roller recomputes `powerSpent` only when the selection *changes*:

    const gambitChange = formObject.object.gambit !== undefined
                      && this.object.gambit !== formObject.object.gambit;

Pre-select a gambit and that is false on submit, so the roller keeps whatever
`powerSpent` it was handed. The panel's number is the one that gets spent.

That makes the system's cost table something this module mirrors, exactly like
the condition maths in `targetNumbers()` — and it is watched the same way, as a
fourth block in `tools/check-roller.py`.

## Two things found on the way

**Grapple has no cost.** The system adds `grapple` to the dropdown under Combat
Reforged but never adds it to `gambitCosts`, so the lookup returns `undefined`
and the roller opens with nothing wagered. (The second, dead copy of the table
in an `activateListeners` left over from ApplicationV1 has `'grapple': 0`,
which is not the rule either.) The Storyteller's Guide prices it at the higher
of the target's Physique or Athletics, or half an antagonist's relevant pool.
The panel fills that in and says on the row that it is doing so, since "most
relevant pool" is a judgement it cannot make.

**The drift check never fired.** `checkAgainstRoller()` reads
`game.rollForm.object`, but both the system's `weaponAttack` and this module's
own `#onRoll` assign the *promise* that `render()` returns:

    game.rollForm = new RollForm(...).render(true);

`ApplicationV2.render` is `async`, and `RollForm` does not override it, so
`game.rollForm.object` was `undefined` and the check returned early every
single time. The warning about the panel's maths disagreeing with the roller
could not have fired since it was written. Fixed by awaiting anything thenable
before reading `.object`, which covers the system's assignment as well as ours.

## What is not covered

- **Hero's Trick.** A gambit can be paid for at Step 5 out of the Power a
  withering attack just earned, which is the one way a gambit reaches a target
  who is still standing. The panel says so in the blocked button's tooltip but
  does not offer it as a flow — the roll has already happened by then, and the
  panel has no hook into Step 5.
- **The Disarm surcharge.** Disarming a battle group costs 1 more Power for
  every Size above 2. The system does not apply it and neither does the panel.
- **Escape and Throw.** Combat Reforged makes these grapple-specific actions
  rather than gambits, so they belong to a grapple flow the panel does not have.
