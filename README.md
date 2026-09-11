# Poise & Break — Turn Panel

A Foundry VTT module for [Exalted: Essence](https://github.com/Aliharu/Foundry-ExEss).
On your turn it reads your target's state and offers only the attacks that are
legal against them, then hands the roll to the system's own dice roller.

Built for **Combat Reforged**, the alternate combat system in the Exalted:
Essence Storyteller's Guide. With that setting off, it falls back to the
standard rules and leaves both attack types available.

## What it does

- Shows your Power, Poise (or Hardness) and motes at a glance.
- Reads your target's token and labels them **Standing**, **In Break** or a
  **battle group**.
- Enables only the attacks that can actually land:
  - a target with Poise can only be hit by **withering** attacks;
  - a target in Break can only be hit by **decisive** attacks and gambits;
  - battle groups can't be withered at all, except inside a grapple.
  - Blocked buttons stay visible and say why on hover, so the rule teaches
    itself rather than hiding.
- Tells you, when you are in Break, how much Poise you still need — Power you
  gain refills Poise before it reaches your pool.
- Buttons for Build Power, Focus Will, social and plain rolls.

## What it does not do

It never rolls dice, applies damage or changes a sheet. Every button opens the
system's own roller, which does all of that. If the system's maths changes, this
module needs no update.

## Requirements

- Foundry VTT **v14**
- Exalted Essence system **3.0.0+**

## Install

Copy this folder into your Foundry data directory as
`Data/modules/essence-poise-break/`, restart Foundry, and enable it in the
world.

## Using it

The panel opens by itself when a combat turn reaches a character you control.
Players get their own characters; the Storyteller gets the ones no player owns.
Turn that off per-user in **Configure Settings → Module Settings**.

**Target a token before rolling.** The system's roller reads Defense, Soak and
Poise from your target, so an untargeted attack can't report whether they Broke.

To open it by hand, make a macro:

```js
game.modules.get("essence-poise-break").api.open();
```

## How it hooks in

The system exposes the roller through the same API it writes into hotbar macros:

```js
game.exaltedessence.weaponAttack(itemUuid, "withering" | "decisive" | "gambit");
new game.exaltedessence.RollForm(actor, options, {}, { rollType }).render(true);
```

Legality comes from the target's own token. The system registers `break` as a
status effect and clears it itself when Poise returns to full, so reading that
status is enough.

The panel re-renders when you change target, when Break is applied or removed,
and when Power or Poise changes.

## Known limits

- Only **equipped** weapons appear, since `weaponAttack` needs a weapon's uuid.
- It reads the first token you target; multiple targets are ignored.
- `game.exaltedessence` is the system's macro API rather than a documented one.
  It is stable enough for hotbar macros, but a system update could rename it —
  in which case the buttons report the error rather than failing silently.
