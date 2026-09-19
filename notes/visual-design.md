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

It is the biggest text on the map. It first shipped at about two thirds of the
token's radius - 31 pixels on an ordinary token - which the table found too
small, so it is now a little over the radius, from 48 to 120 pixels: about 60
on an ordinary token, well above a Charm callout.

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

There are five moments, and one thing that stays moving:

- **The panel's crack.** Only the render that first finds a target in Break
  marks it (`data-just-broke`), so the shards crack once, not on every refresh.
- **The map shatter.** About a second long. The ring arrives with the crack,
  not before it. The colour passes jade, then light, then red, because a straight
  blend from jade to red goes through a dull grey-brown halfway.
- **The decisive cut-in.** About a second and a half, across the whole screen.
  See below.
- **The anima flare.** A little over two seconds, at the token, with a caption
  and an edge glow on screen. See below.
- **Charm callouts.** About a second and a half per name, at the token. See
  below.
- **The Bonfire aura.** For as long as a character stays at Bonfire or Iconic.
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

Its text started out capped at 34, 150 and 24 pixels for the name, the word
and the Charms, and the table wanted it bigger, as with BREAK and the callouts.
They now reach 52, 220 and 38 pixels, in a taller band with a slightly
narrower portrait, measured to fit from the preview's small frame up to a
1920 by 1080 screen.

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

## The anima flare

Anima is the Exalt made visible, and Bonfire is when it can no longer be
hidden. So the flare happens where the character stands: a column of light in
their anima colour shoots up out of the token, a white-hot core inside a
coloured sheath, a ring bursts out at its foot, and embers rise through it. It
is drawn in added light, so it brightens the map under it rather than covering
it.

It is drawn with plain PIXI shapes rather than textures - stacked bands that
thin and fade towards the top - so it needs nothing loaded and can be tested
and previewed on its own, like the shatter.

The first column was seven token radii tall and a little over half a radius
wide, which read as a candle standing on the token rather than an anima
erupting. It is now twelve radii by 0.85, over a wider pool of light and with
larger embers.

The screen gets two things. A glow runs round its edges as the column erupts,
and a caption names the level and the character, with the first sentence of a
player character's iconic anima: the thing everyone at the table would see.

The caption started out capped at 96, 30 and 22 pixels for the level, the name
and the iconic line, and the table wanted it bigger, as with every other piece
of text here. They now reach 170, 50 and 36 pixels, measured to fit from the
preview's small frame up to a large screen.

Photosensitive mode and reduced motion get a slow, faint column with no ring,
no flicker and no glow round the edges, and a caption that only fades.

## The Bonfire aura

The flare is the moment anima reaches Bonfire, and then it was gone: nothing
on the map said who was still blazing. The aura keeps it there. Tongues of
flame in the anima colour lick up from the token's rim over a breathing halo,
each flickering at its own pace, and they die away over most of a second when
the anima falls.

Fire rises, so each flame leans up as well as out: the tallest burn over the
top of the token and the shortest underneath, where leaning up would send them
back into the token. They start at the rim, so they lap over the token's edge
at most and never cover its art. Iconic has more flames and reaches much
higher - nearly two and a half radii against one and a half. They were first drawn at
under a radius, which read as a crown of petals rather than fire.

It is the one effect nobody sends. Every client has the actors and the level
the system derives from them, so each works out which tokens on its own scene
are burning, and a player who joins or reloads mid-fight sees the aura at once.
One ticker draws them all, and stops when none is burning.

It sits just under the flare and the floating text, so those play over it.
Photosensitive mode keeps only the halo, breathing slowly, with no flames.

## Charm callouts

A Charm being used is named out loud, the way a technique is in the shows this
game borrows from. So the name comes out of the token in the BREAK text's
lettering and style - the same carved face, dark stroke and shadow - and bursts
in at nearly twice its size before it lands, then rises and fades.

It is quieter than BREAK in what it does, not in how big it is. It does not
crack, and its colour is the character's anima tinted towards light rather than
break red, since a Charm is theirs rather than something done to them. It first
shipped at about a third of the token's radius, and at the table that was too
small to read with the map zoomed out, so a name is now a little over two
thirds of the radius, from 30 to 68 pixels - still under the BREAK word, which
grew too.
Several Charms come out a quarter of a second apart, each above the last, so a
stack of techniques reads as a sequence rather than a block of text.

A decisive attack names its Charms at the token when the dice are rolled and
again in the cut-in if it lands. The first is the declaration, the second the
payoff.

## Anima colours

The anima colour picker on the sheet defaults to white, and most sheets are
never changed, so every effect would have looked the same. Exalted gives each
kind of Exalt, and most castes and aspects, a colour of its own - a Wood-aspect
Dragon-Blood's anima is green, an Infernal's the green of the Yozis' fire, a
Night Caste's the dark of the hour - so with no colour picked the module takes
one from the sheet's own words: the caste first, since it is the most specific,
then a Liminal's nature, then colour words in the anima descriptions a player
has written, then the Exalt type.

The colours are chosen to read on a band of light and as added light on the
map: none is near white, which the effects already treat as no colour, and the
dark ones - midnight, soulsteel - are still dark enough to carry white text.

Matching a colour at the moment it is drawn leaves the system's own anima glow
white, since that reads the sheet. Rather than write to sheets quietly, there
is a Storyteller's button in Module Settings that lists every sheet still on
the default and fills them in when pressed. The rule is the same either way: a
colour someone picked is never overwritten.

An unlinked token keeps its own copy of the sheet inside the scene, and that
copy is the one its anima glow reads, so the button offers those too, each
named with its scene. A token and the actor it came from are two sheets and
can both be in the list. The sidebar's actors are written in one update; a
token's copy is written through the token's own actor, which is what keeps the
colour in that token rather than spreading it to every other token from the
same actor.

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
