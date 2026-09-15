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
- **Shows Poise as jade shards, and Break as them cracking.** Your own Poise sits
  beside your name; your target's sits in one card with the verdict, edged in
  the colour of their state. When a target Breaks while the panel is open, the
  shards crack once. The number is always printed beside them too.
- **Plays a Break effect on the map.** The moment a token Breaks, a ring of jade
  shards flashes and scatters off it, and the word BREAK slams down over the
  token, cracks in two, turns red, rises and fades. It plays on every player's
  screen, however Break was applied. A token a player can't see never shows it,
  so it never gives a hidden token away. On a screen showing it, Foundry's own
  small "+(Break)" is skipped, so the news isn't said twice. Foundry's
  photosensitive mode turns it into a faint ring and a slow fade, and each
  player can switch it off.
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

## The decisive cut-in

When a decisive attack lands, the attacker cuts in across everyone's screen: a
slanted band in their anima colour, their portrait breaking out of it, the word
DECISIVE, and the Charms they put into the strike, over speed lines. It lasts
about a second and a half and never takes a click.

- It plays for any decisive hit rolled through the system's roller — from the
  panel, the character sheet or a hotbar macro. A miss plays nothing.
- The colour is the **Anima Color** on the character's sheet. Left at the
  system's default of white, the band is orichalcum instead.
- Each player sees it only for an attacker they can see on the map. For an
  attacker on another scene, it shows to that character's owners and the
  Storyteller.
- An antagonist's cut-in keeps its Charms from the players unless the
  Storyteller turns on **Name the Storyteller's Charms**.
- With Foundry's photosensitive mode or the browser's reduced-motion setting,
  it fades in and out with no flash, speed lines or slam. Each player can turn
  it off with **Show the decisive cut-in**.

## The anima flare

When a character's anima rises into **Bonfire** — or into **Iconic** — a column
of light in their anima colour erupts from their token, a ring bursts out at its
foot and embers rise through it. The screen's edges glow for a moment, and a
caption names the level and the character, with the first line of a player
character's iconic anima from their sheet.

- It plays however the anima rose: the roller spending motes, the sheet, or the
  token HUD. Rising again from Bonfire to Iconic plays it again.
- Each player sees it only for a token they can see, on the scene they are
  viewing. An antagonist's flare shows its name and level but keeps its iconic
  anima text to the Storyteller.
- With Foundry's photosensitive mode or reduced motion it is a slow, faint
  column with no ring and no flash round the edges. Each player can turn it off
  with **Show the anima flare**.

## Charm callouts

The moment a character uses a Charm, its name bursts from their token in the
same carved lettering as the BREAK text, rises and fades. Several Charms
together come out one after another, stacked, with any past four counted.

- A Charm counts as used when the roller pays for it — as the dice are rolled,
  once per roll — or when it is spent from the character sheet. Switching an
  active Charm off from the sheet calls nothing out.
- Each player sees callouts only for a token they can see, on the scene they
  are viewing. An antagonist's Charm names stay with the Storyteller unless
  they turn on **Name the Storyteller's Charms**, which also covers the cut-in.
- A decisive attack names its Charms twice, on purpose: at the token as the
  dice are rolled, then across the screen in the cut-in if it lands.
- With Foundry's photosensitive mode the names fade in and out with no burst.
  Each player can turn them off with **Show Charm callouts**.

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

The decisive cut-in is the one place the module wraps the roller. The Charms
added to a roll live only in the rolling client's roller — nothing about them
reaches the chat card — so `RollForm#attackSequence`, the system's own
attack-animation step at the end of a damage roll, is wrapped. It runs first
and unchanged; then, if the roll was a decisive hit, the module plays the
cut-in and sends it to every other client over its socket. Anything that goes
wrong there is caught and logged, so it can never break a roll.

The anima flare reads the anima level the system itself derives, rather than
its thresholds. The client that makes a change to an actor notes the level in
`preUpdateActor` and compares it in `updateActor`, once the system has
recalculated it; if it rose into Bonfire or Iconic, that client plays the flare
and sends it over the same socket. The `preUpdateActor` watcher never returns a
value, because Foundry cancels an update when one of those returns `false`.

Charm callouts wrap two more of the system's steps, in the same way: the
roller's `_updateRollerResources`, where it pays for the Charms added to a roll,
and the actor's `spendItem`, where the sheet pays for one. Each runs first and
unchanged; the callout follows, sent over the same socket. The roller pays
again after a damage roll, so each roller calls a Charm out only once.

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
  the roller's condition block, its Defense branch, its social block, its
  gambit cost table and the lines the decisive cut-in and Charm callouts rely
  on — plus, from the actor, where anima levels are worked out and where the
  sheet spends a Charm — and compares each with the fingerprint in
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

## Previewing changes

`tools/preview/` renders the panel in every state, in both the dark and light
themes, and the Break effect, the decisive cut-in, the anima flare and Charm
callouts frame by frame, all from the module's own code under the same stubbed
Foundry the tests use.

```bash
python tools/preview/serve.py
```

Then open <http://127.0.0.1:8791/tools/preview/>. For a faithful look, copy
`public/css/foundry2.css` and `public/fonts/` from your own Foundry install into
`tools/preview/.foundry/`, which git ignores. Without them the page still
renders, in fallback fonts.

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
- **The Break effect plays on the scene you are viewing.** A token that Breaks
  on another scene shows nothing when you get there.
- **The cut-in needs every client on this version, after a restart.** It
  travels over the module's socket, which Foundry opens only when it loads a
  manifest that asks for one.
- **The flare needs a token to erupt from, where the change was made.** A
  character's anima raised by someone viewing a scene without that
  character's token on it plays no flare.
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
