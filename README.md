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
- For sorcerers, a **Sorcery** section: your current Will out of 10, every spell
  you know with its Will cost (dimmed when you can't afford it yet), a Focus
  Will button, and cast buttons gated by the same rule as weapons.
- Buttons for Build Power, social and plain rolls.

## What it does not do

It never rolls dice, applies damage or changes a sheet. Every button opens the
system's own roller, which does all of that. If the system's maths changes, this
module needs no update.

## Player guide

A companion one-page guide to the Combat Reforged roll flow, for players rather
than for the module:

**https://claude.ai/code/artifact/fe502d68-5e84-428a-9085-303117b300f0**

Pick your target's state and it shows which attack to make, what to wager, and
what each result does, alongside the eight attack steps, the Build Power
actions, and how Break is escaped. The panel in this repository automates the
same decision at the table.

*That page is private for now, so the link works only for its author. It
summarises rules from the Storyteller's Guide, which is still an unpublished
draft.*

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

Casting is not a roll type of its own. In Essence you spend the spell's Will,
and an attack spell is rolled as an ordinary attack with Sagacity replacing a
combat Ability — so the cast buttons open the normal attack roller with the
ability preset, and the weapon left off. The system's roller treats the weapon
as optional, which is what makes that work.

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

## Licence

MIT — see [LICENSE](LICENSE).

This module contains no game text. It reads your own character and target data
inside Foundry and opens the system's roller; the rules it follows come from
*Exalted: Essence* and its Storyteller's Guide, which you need to own to play.
Not affiliated with or endorsed by Onyx Path Publishing.
