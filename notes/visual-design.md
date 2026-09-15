# Visual design

The panel's job is to tell you the one legal move against your target, at a
glance, mid-fight. The styling exists to make that faster, and to make Break
feel like the event it is.

## Colour carries the rules

Three colours, each meaning one thing, taken from the player guide so the two
speak the same language:

| | dark | light | means |
| --- | --- | --- | --- |
| jade | `#63C7A0` | `#1E6B53` | Poise, standing, withering |
| orichalcum | `#E5B356` | `#8B5B10` | Power, decisive, gambits |
| break red | `#EE7163` | `#A53028` | Break |

The panel's first colours were mid-tones (`#2e8f6d`, `#c98b24`, `#c2453a`)
that lost contrast on Foundry's dark interface. The guide already had tuned
pairs for both themes, so those replaced them.

Dark is the base because Foundry's interface is. A `.theme-light` class on the
window, or on an ancestor that isn't overridden by `.theme-dark`, swaps in the
light values.

## Type

Modesto Condensed for names and the verdict, Signika for everything else. Both
ship with Foundry, so the module loads nothing from the internet. The guide uses
Grenze, which would have tied the two together more tightly, but that would mean
either a Google Fonts request from every player's browser or bundling font files
in the module. Modesto's carved, condensed capitals do the same job.

## The signature: Poise as jade shards

Poise is drawn as a row of cut crystals: full for what's left, faint for what's
been worn away. In Break every shard splits along a jagged crack and turns red.
The number is always printed beside them, since the shards are for a glance
and the number is for counting.

It carries through to the map. When a token Breaks, the same shards ring it,
flash through white light, turn red and scatter. One visual idea in both places:
Poise is a crystal, and Break is it shattering.

Everything else is kept quiet so the shards read first. There are no boxes
around stats, no dividers between most sections, and one card: the target and
the verdict together, edged in the target's state.

## The word BREAK

The shatter carries the word too. It slams down from nearly twice its size and
lands, then shudders and cracks in two along a jagged line: two copies of the
word, each masked to one side of the crack, pulled apart. It cools from
white-hot to break red and rises out. At 1.7 seconds it lasts longer than the
shards, because a word has to be read and a flash does not.

It is drawn with Foundry's PreciseText, which renders at double resolution, so
it stays sharp at any zoom. It sits at the token rather than across the screen:
a banner would announce that a hidden token had Broken, and it would cover the
table's view of the map.

Foundry already floats a small "+(Break)" from the token when the status lands.
With BREAK playing, that says the same thing twice in the same place, so the
module wraps `ActiveEffect#_displayScrollingStatus` and skips it for Break alone,
only as it lands, and only on a client showing the effect. Everything else,
including "-(Break)" as Break ends, is left exactly as Foundry draws it.

## Motion

There are three moments, and nothing else moves:

- **The panel's crack.** Only the render that first finds a target in Break
  marks it (`data-just-broke`), so the shards crack once, not on every refresh.
- **The map shatter.** About a second long. The ring arrives with the crack,
  not before it. The colour passes jade, then light, then red, because a straight
  blend from jade to red goes through a dull grey-brown halfway.
- **The decisive cut-in.** About a second and a half, across the whole screen.
  See below.

Foundry's photosensitive mode turns off the panel's crack and reduces the map
effect to a slow, faint ring. The browser's reduced-motion preference turns the
panel's animation off entirely. On the map, `Token#isVisible` decides who sees
the shatter, so it never reveals a token a player can't see.

## The decisive cut-in

BREAK happens to the target, at the token. A decisive hit is the attacker's
moment, so it takes the screen, briefly, the way a super move cuts in: a band
slashes in from the left at a tilt, the portrait breaks out of its top edge,
DECISIVE slams down from twice its size, the Charms behind the strike are
listed underneath, and the band carries on out to the right. Speed lines run
behind it and one flash marks the impact.

The band is the attacker's anima colour, from their sheet, so each Exalt's
strike looks like theirs. The system's default anima colour is white, which is
no colour at all on a band of light, so near-white falls back to orichalcum -
the colour this module already gives decisive attacks.

It is drawn in the page, not on the canvas. It belongs to the screen rather
than a place on the map, page text stays sharp at any size, and it sits above
the interface without ever taking a click. Its sizes are container units of the
cut-in itself, so the preview's small frame and a full screen share one set of
rules.

Photosensitive mode and reduced motion get a fade where the band rests: no
flash, no speed lines, no slam.

## Checking it

`tools/preview/` renders every panel state in both themes, and the shatter frame
by frame, from the module's own code. Two things about the Claude browser pane
it was checked in, in case they come up again:

- It can't screenshot a scrolled page, so the preview moves what it needs to
  the top instead of scrolling.
- It barely advances animation time, so a mid-animation frame can look like the
  finished state is wrong. `document.getAnimations().forEach(a => a.finish())`
  shows the true end state.

The preview has no tokens, so it could not show the worst bug the BREAK text
shipped with. The effect was added to the interface group at zIndex 0, below the
token layer (200), and each token draws a void mesh that erases interface
content beneath it inside its outline. The word, sitting inside the token,
vanished; the shards had been cut off at the token's edge all along. It showed
up only on the live canvas, by drawing the same word three ways side by side.
The effect now sits at Foundry's floating-text level, and
`tests/break-layer.test.mjs` pins it there.

A background Chrome tab also freezes the canvas clock entirely, so an effect
started in one never finishes. That is not a bug in the effect, but it will
look like one when testing from a tab that isn't in front.
