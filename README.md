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

- Foundry VTT **v14** (14.365 or later)
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

**Every effect below can be switched off at once** with **Cinematic effects**,
at the top of the effect settings - for a slow machine, or a quiet session.
It is each player's own, it leaves the panel and its rules alone, and each
effect keeps its own setting for when the switch goes back on.

## ROUND 1, FIGHT!

As a combat starts, a fighting game's opening crosses everyone's screen: a dark
band edged in orichalcum snaps open, ROUND 1 slides in and out through it, and
FIGHT! slams down with one flash before the band closes. It takes under two and
a half seconds and never takes a click.

- It plays once per fight, as the combat reaches round one. Stepping back into
  round one does not play it again; resetting the combat does.
- Each player sees it only if they are looking at the scene the fight is on.
- With Foundry's photosensitive mode or reduced motion, the band and both words
  fade in and out, with no slide, slam or flash. Each player can turn it off
  with **Show the ROUND 1, FIGHT! splash**.

## VICTORY / DEFEAT

As the Storyteller ends a combat, the fight's result crosses everyone's screen:
VICTORY in orichalcum over turning rays, with how many rounds it took, if every
foe is down; DEFEAT on a dark band, falling heavily, if the whole party is.

- Foes are tokens set **Hostile** or **Secret**. The party is player characters
  and tokens set **Friendly**. **Neutral** tokens are on neither side.
- Down means what it does for the DEFEATED finisher: marked defeated in the
  tracker, **Incapacitated**, or Foundry's defeated status.
- A fight that ends any other way — foes fleeing, a parley, a combat ended
  early — ends quietly.
- Each player sees it only if they are looking at the fight's scene. With
  Foundry's photosensitive mode or reduced motion it fades in and out. Each
  player can turn it off with **Show the VICTORY / DEFEAT finale**.

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

## Hit-stop and screen shake

A decisive hit lands the way it would in a fighting game. For a split second
the map freezes on a stark black-and-white frame — token movement, the attack's
effects and any Bonfire aura all held mid-motion — then the screen jolts, hard
at first and settling, as the cut-in slashes in.

- The freeze is real: it stops the canvas's ticker, which drives everything
  that moves on the map, and always starts it again.
- It follows the cut-in's rule for who sees it, and plays even with the cut-in
  turned off.
- It is left out entirely with Foundry's photosensitive mode or the browser's
  reduced-motion setting. Each player can turn it off with **Hit-stop and screen
  shake**.

## Poise damage numbers

When a token's Poise falls, the amount pops off it in the BREAK text's
lettering, with POISE underneath: jade while they still stand, break red and
bigger on the hit that Breaks them. Poise coming back while in Break shows as a
paler plus. So you can see what a withering attack did without reading the
chat card.

- It shows every change to Poise, from a roll or from the sheet, on every
  client, with nothing sent: each client remembers the Poise of the tokens it
  has drawn and shows the difference.
- The number sits up and to the right of the token, so the BREAK word can land
  in the middle at the same moment. Several close together stack.
- Each player sees it only for a token they can see. With Foundry's
  photosensitive mode the numbers fade in and out. Each player can turn them
  off with **Show Poise damage numbers**.

## The DEFEATED finisher

When a character is taken out, the world slows and drains of colour, the
screen's edges darken, and DEFEATED falls onto their token in the BREAK text's
carved lettering. It lands hard, cools to ash, holds, then sinks and fades.

- The system never marks anyone out by itself, so it plays when the table does:
  the **Incapacitated** status (the skull on the token HUD), Foundry's own
  defeated status if something supplies it, or the **defeated** toggle in the
  combat tracker. Doing two of those at once plays it once.
- The slow motion is real: token movement and effects on the map run at a
  third of their speed for over a second. The word keeps its own time.
- Each player sees it only for a token they can see.
- With Foundry's photosensitive mode or reduced motion, the word only fades in
  and out, with no slowing, draining or darkening. Each player can turn it off
  with **Show the DEFEATED finisher**.

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

## The Bonfire aura

The flare marks the moment; the aura keeps it showing. For as long as a
character's anima stays at **Bonfire** or **Iconic**, tongues of flame in their
anima colour burn round their token over a breathing halo, reaching higher at
Iconic, and they die away when the anima falls.

- The flames rise from the token's rim and lean outwards and up, so the token's
  art stays clear. They follow the token as it moves.
- Every client works out for itself which tokens are burning, from the actors
  it already has, so the aura is there for anyone joining or reloading
  mid-fight. Each player sees it only on tokens they can see.
- With Foundry's photosensitive mode it is a slow, faint glow with no flames.
  Each player can turn it off with **Show the Bonfire aura**.

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

## Gambit callouts

When a gambit lands, its name bursts from the attacker's token the way a
Charm's does — DISARM!, KNOCKBACK!, REVEAL WEAKNESS! — in orichalcum, the colour
the panel gives gambits, rather than the character's anima colour.

- It plays only when the gambit lands: the roller resolves a gambit only then,
  and that step is what it follows. A missed gambit calls nothing out.
- An antagonist's gambits are named for everyone, unlike its Charms, since the
  whole table sees a gambit happen.
- Each player sees it only for a token they can see. With Foundry's
  photosensitive mode the name fades in and out. Each player can turn them off
  with **Show gambit callouts**.

## Miss callouts

When an attack or gambit misses, the target calls it out, in pale steel:
**PARRIED!** or **DODGED!** for a character, by whichever of Parry and Evasion
stopped it - the same one the roller used - and **MISS!** for an antagonist,
who has a single Defense.

- It follows the roller's own test: accuracy short of the target's Defense.
  An attack with no target calls nothing out.
- Each player sees it only for a token they can see. With Foundry's
  photosensitive mode the word fades in and out. Each player can turn them off
  with **Show miss callouts**.

## Anima colours

The cut-in, the anima flare, the Bonfire aura and Charm callouts are drawn in the character's
anima colour. A colour picked on the sheet always wins. Left at the system's
default white, the module finds one that fits the character, in this order:

1. **Their caste or aspect**, as written on the sheet — Wood Aspect is green,
   Fire red, Night Caste midnight blue, Journeys gold. The caste is free text,
   so it is matched loosely: "Wood-aspected", "Chosen of Jorneys" and "the Secret
   caste" all find their colour, and a caste word from another Exalt type, or a
   plain colour word ("Crimson"), counts too.
2. **A Liminal's nature** — blood, breath, flesh, marrow or soil.
3. **Colour words in their anima** — the passive, active and iconic descriptions
   on the Charms tab: "a burning phoenix" is fire, "moonlit" silver.
4. **Their Exalt type** — Solar gold, Lunar moonsilver, Abyssal crimson, Infernal
   green hellfire, and so on — and orichalcum when there is none.

Only the module's effects use it. The system's own Token Magic anima glow reads
the sheet's colour itself, so it stays white until one is picked there — or
until the Storyteller presses **Fill in anima colours** in Module Settings.
That window lists every sheet still on the default white with the colour
matched for it — the actors in the sidebar, and the unlinked tokens on your
scenes, which each keep their own copy of a sheet — and writes them when you
press the button. A colour already picked is never touched, and nothing is
written until you press it.

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

Gambit callouts wrap the roller's `_resolveGambit`, which it calls only when
a gambit lands, in the same way, and read the gambit from `this.object.gambit`.
Miss callouts wrap `attackSequence` too, after the cut-in: the roller runs it
at the end of every attack, hit or miss. Each wrap keeps the marks the other
left on it, so neither ever wraps twice.

Charm callouts wrap two more of the system's steps, in the same way: the
roller's `_updateRollerResources`, where it pays for the Charms added to a roll,
and the actor's `spendItem`, where the sheet pays for one. Each runs first and
unchanged; the callout follows, sent over the same socket. The roller pays
again after a damage roll, so each roller calls a Charm out only once.

The Bonfire aura sends nothing. Each client brings its auras into line with the
actors whenever the canvas is drawn, an actor is updated, or a token is drawn
or deleted, and one ticker on the canvas draws every aura each frame.

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

## Where things are

`scripts/turn-panel.js` is what Foundry loads. It holds the settings and the
hooks that connect everything to Foundry and the system, and imports the rest,
one file for each part:

| file | what it holds |
| --- | --- |
| `core.js` | the module's id, and the system version it was checked against |
| `rules.js` | what is legal against a target, the roller's numbers, gambit costs |
| `gambits.js` | gambits the system leaves unfinished, and clearing their effects |
| `panel.js` | the turn panel |
| `break-effect.js` | Poise shards, the shatter and the BREAK word |
| `poise-numbers.js` | Poise damage numbers |
| `cut-in.js` | the decisive cut-in, and the hit-stop and shake before it |
| `defeated.js` | the DEFEATED finisher |
| `splash.js` | ROUND 1, FIGHT! and VICTORY / DEFEAT |
| `anima-colors.js` | matching anima colours, and the fill-in button |
| `anima-flare.js` | the anima flare |
| `bonfire-aura.js` | the Bonfire aura |
| `callouts.js` | Charm, gambit and miss callouts |

Each file imports only what it uses from the others, and `turn-panel.js`
re-exports them all for the tests.

## Previewing changes

`tools/preview/` renders the panel in every state, in both the dark and light
themes, and the Break effect, the decisive cut-in, the anima flare, the Bonfire
aura and Charm callouts frame by frame, all from the module's own code under the same stubbed
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
