# Poise & Break — Turn Panel

A Foundry VTT module for [Exalted: Essence](https://github.com/Aliharu/Foundry-ExEss).
On your turn it reads your target's state and offers only the attacks that are
legal against them, then hands the roll to the system's own dice roller.

Built for **Combat Reforged**, the alternate combat system in the Exalted:
Essence Storyteller's Guide. With that setting off, it falls back to the
standard rules and leaves both attack types available.

## What it does

- **Tells you what to do, and why.** A verdict line names the move, does the sum
  that decides it — "7 successes Breaks them: 4 to beat Defense, then 3 more for
  their Poise" — and states the rule behind it. The explanation can be switched
  off per user once your table knows the system.
- Prompts for the situation you're actually in: that your Power is idle until
  the target Breaks, or that being in Break means Power refills Poise first.
- Shows your Power, Poise (or Hardness) and motes at a glance.
- Reads your target's token and labels them **Standing**, **In Break** or a
  **battle group**.
- Enables only the attacks that can actually land:
  - a target with Poise can only be hit by **withering** attacks;
  - a target in Break can only be hit by **decisive** attacks and gambits;
  - battle groups can't be withered at all, except inside a grapple.
  - Blocked buttons stay visible and say why on hover, so the rule teaches
    itself rather than hiding.
- **Names the gambit.** The Gambit button opens a list of all nine gambits —
  plus Grapple, once Combat Reforged turns it into one — each priced in Power
  for the weapon in your hand, since a smashing weapon makes Knockdown cheaper
  and a flexible one makes Ensnare cheaper. Picking one opens the system's
  roller with that gambit already selected and the Power already wagered. A
  gambit you can't use stays listed with the reason: Pull needs a weapon with
  the pull tag, Disarm needs a target to price it against.
- **Finishes the two gambits the system doesn't.** Knockback and Grapple fall
  through the system's gambit resolution without applying anything. The panel
  gives Knockback its Defense penalty of 1 per extra success, and Grapple the
  −1 both sides take — as a single Grappling effect that carries the penalty,
  so clearing the status clears the penalty with it. Rows the panel finishes
  say so.
- **Clears gambit effects once they're over.** Distract, Pull and Knockback
  lower Defense for the rest of the round; Reveal Weakness cuts Soak for a set
  number of rounds. Nothing in the system removes them, and the roller creates
  them without a start round, so Foundry can switch a penalty off before its
  round is up. The Storyteller's client records when each began, deletes it once
  its time runs out, and clears the rest when the combat ends. A world setting
  turns this off.
- Tells you, when you are in Break, how much Poise you still need — Power you
  gain refills Poise before it reaches your pool.
- For sorcerers, a **Sorcery** section: your current Will out of 10, every spell
  you know with its Will cost (dimmed when you can't afford it yet), a Focus
  Will button, and cast buttons gated by the same rule as weapons.
- Buttons for Build Power, social and plain rolls.

## What it does not do

It never rolls dice or applies damage. Every button opens the system's own
roller, which does all of that.

It changes sheets in two places, both about gambits:

- **Knockback and Grapple.** The system resolves six of the ten gambits and
  leaves those two applying nothing, though the book gives both a Defense
  penalty — so the panel supplies it. It does not write to the target itself;
  it adds to the arrays the system is about to read, so the system's own update
  path applies them, including the socket relay that makes it work for a player
  who is not the Storyteller.
- **Timed gambit effects.** It records when each began and deletes each once
  its time is up. Only the Storyteller's client does this, and only for the
  gambits' own effects — the sheet's Defense Penalty button, Onslaught and
  Grappling are never touched.

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
Turn that off per-user in **Configure Settings → Module Settings**, where you
can also switch off the rule explanations.

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

## Staying in step with the system

`targetNumbers()` mirrors the modifiers the system's roller applies to a target
— prone, surprised, cover, concealment, grappling, wounds — because the panel
has to predict a roll before the roller runs. The gambit list duplicates the
roller's cost table for the same reason — the panel opens the roller with a
gambit already chosen, and the roller only recomputes the cost when the choice
changes, so the panel's number is the one that gets spent. Duplicated logic
drifts, so four things watch for it:

- **The panel checks itself against each roll.** When you roll from a button
  here, it compares what it advised with what the roller actually computed and
  says so if they differ, naming both numbers. Purely diagnostic, and wrapped so
  a broken check can never break a roll.
- **A weekly job watches the system's source.** `tools/check-roller.py` extracts
  the roller's condition block, its Defense branch, its social block and its
  gambit cost table, and compares each with the fingerprint in
  `.roller-watch.json`. It also compares the system's latest release with the
  version the panel was verified against. Either change fails the run, so you
  hear about it before a session rather than during one.
- **The verified system version is recorded.** The module notes which version it
  was checked against and mentions it in the console when a world runs a
  different one.
- **Tests run on every push.** `tests/` runs the module's shipped code against
  a stubbed Foundry: gambit pricing, the effects the panel applies, the grapple
  race, the drift check, and clearing timed effects. Each one started as a real
  bug. Run them locally with `node --test tests/*.test.mjs`.

Fixing drift is one function. The panel's working line tells you which modifier
disagreed; correct `targetNumbers()`, then re-record with
`python tools/check-roller.py --update`.

## Known limits

- Only **equipped** weapons appear, since `weaponAttack` needs a weapon's uuid.
- It reads the first token you target; multiple targets are ignored.
- **Grapple's Power cost is the panel's own.** The system lists Grapple in its
  gambit dropdown but has no cost for it, so choosing it there wagers nothing.
  The panel fills that in — the higher of the target's Physique or Athletics,
  or half an antagonist's primary pool — and says so on the row, because which
  pool is the relevant one is the Storyteller's call.
- **The panel only finishes a gambit it launched.** Roll one from the character
  sheet or a hotbar macro and you get the system's behaviour, penalty and all
  missing. There is no global hook, deliberately: one roller patched from a
  module is enough surface area.
- **Ending a grapple is manual.** The panel adds the Grappling effect to both
  sides; nothing removes it when someone escapes. Clear the status on both
  tokens — the penalty goes with it.
- **Only combatants are swept.** A gambit against a token that isn't in the
  combat tracker keeps its effect until someone removes it.
- `game.exaltedessence` is the system's macro API rather than a documented one.
  It is stable enough for hotbar macros, but a system update could rename it —
  in which case the buttons report the error rather than failing silently.

## Licence

MIT — see [LICENSE](LICENSE).

This module contains no game text. It reads your own character and target data
inside Foundry and opens the system's roller; the rules it follows come from
*Exalted: Essence* and its Storyteller's Guide, which you need to own to play.
Not affiliated with or endorsed by Onyx Path Publishing.
