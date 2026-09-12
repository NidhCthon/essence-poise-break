# Social influence in the panel

The panel guides physical attacks and says nothing useful about social
influence. There is a Social button, but it only opens the system's roller -
no target number, no prediction, no guidance. This is what it would take to
give social influence the same treatment.

## The mechanic, as the system implements it

From `_socialInfluence()` in the system's dice-roller:

    resolve   = max(1, target Resolve
                       + opposed Intimacy + opposed Virtue
                       - supported Intimacy - supported Virtue)
    success   = successes >= resolve
    extra     = successes - resolve

Two things matter and neither is obvious from the attack flow:

**Conditions do not apply.** Prone, surprised, grappled and the wound
penalty all reduce Defense. None of them touch Resolve - the system sets
Resolve from the target and then modifies only Defense and Poise. A player
used to the attack block will expect a prone target to be easier to
persuade, and they are wrong.

**Intimacies and Virtues are the whole adjustment.** Appealing to something
the target believes lowers Resolve; arguing against it raises Resolve. The
floor is 1, so a target can never be impossible to influence, and no amount
of support makes it automatic.

## What the panel should show

The same shape as the attack verdict: a headline number, the working behind
it, and a prompt.

- Target Resolve, as printed, with a note that conditions do not change it
- What the roll needs: successes equal to or above Resolve
- The Intimacy and Virtue adjustment as a prompt rather than a number, since
  the panel cannot know which apply - that is a table judgement made when the
  roll is declared
- Extra successes above Resolve are what the influence buys

## What it must not do

Do not fold the Intimacy and Virtue adjustment into a predicted number. The
roller asks for those at roll time and applies them itself; predicting them
would be a guess, and a wrong target number is worse than none.

Do not reuse `targetNumbers()`. It exists to mirror the condition modifiers
the roller applies to Defense, and none of them apply here. Sharing it would
invite exactly the confusion this section is meant to prevent.

## Drift

`tools/check-roller.py` fingerprints the part of the roller the panel
mirrors, so a change upstream turns up as a failed run rather than as advice
that is quietly wrong at someone's table. Anything the panel reproduces from
`_socialInfluence` has to be watched the same way, or the social block
becomes the one piece of the panel that can rot silently.
