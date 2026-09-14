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

## Motion

There are two moments, and nothing else moves:

- **The panel's crack.** Only the render that first finds a target in Break
  marks it (`data-just-broke`), so the shards crack once, not on every refresh.
- **The map shatter.** About a second long. The ring arrives with the crack,
  not before it. The colour passes jade, then light, then red, because a straight
  blend from jade to red goes through a dull grey-brown halfway.

Foundry's photosensitive mode turns off the panel's crack and reduces the map
effect to a slow, faint ring. The browser's reduced-motion preference turns the
panel's animation off entirely. On the map, `Token#isVisible` decides who sees
the shatter, so it never reveals a token a player can't see.

## Checking it

`tools/preview/` renders every panel state in both themes, and the shatter frame
by frame, from the module's own code. Two things about the Claude browser pane
it was checked in, in case they come up again:

- It can't screenshot a scrolled page, so the preview moves what it needs to
  the top instead of scrolling.
- It barely advances animation time, so a mid-animation frame can look like the
  finished state is wrong. `document.getAnimations().forEach(a => a.finish())`
  shows the true end state.
