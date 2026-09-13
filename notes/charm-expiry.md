# End-of-turn charm expiry

The idea was a panel block that drops charms when their duration runs out, so
nobody is still counting a bonus three rounds after it lapsed. Before building
it, it was worth asking how many charms that actually applies to. The answer
changes the feature.

## The numbers

Across the 1591 charms in the compendium:

| | count | share |
| --- | ---: | ---: |
| Round-scale duration in the text | 20 | 1.3% |
| Scene-long ("for the scene", "rest of the scene") | 255 | 16% |
| Commit motes (`cost.committed` set) | 525 | 33% |
| **Marked `activatable`** | **0** | **0%** |

So "end of turn" is the rarest case by a wide margin — twenty charms, and most
of those are movement or one-round stances. The bookkeeping that actually
builds up at a table is the other two rows: committed motes that stay committed
until released, and scene-long effects that everyone forgets at scene end.

Renaming the feature to match is most of the design work. What's wanted is
**"what have I got running, and what should have stopped by now"**, not a
timer for a twentieth of one percent of the charm list.

## The blocker

`activatable` is `false` on every charm in the compendium. The system's
activation mechanism is real and good — `Actor#spendItem()` toggles
`system.active`, spends the motes, adds `cost.committed` to
`motes.committed`, and enables the charm's own ActiveEffects; toggling back
off reverses all of it — but a charm only offers the toggle if it opts in.

None of ours do, so nothing can be running in the first place. **That is a
muncher change, not a panel change**, and it has to land first or there is
nothing for the panel to expire.

Deciding which charms are activatable is the real question. A reasonable first
pass: any charm with `cost.committed > 0`, plus any whose text says it lasts
for the scene. That is 525 + 255 before overlap, and it is a build-time
decision that can be reviewed in the diff rather than guessed at the table.

## There is no duration data to read

Exalted Essence charms have no Duration line. The word "Duration" appears once
in the whole core rulebook, in the index — this is not Third Edition, where
every charm carries one. Duration lives in the prose, phrased differently
charm to charm, and 56% of charms say nothing recognisable at all.

The system has a field for it. `activatableData()` declares:

    endtrigger: new fields.StringField({ initial: "none" }),

and nothing anywhere reads it, writes it, or offers a UI for it. It is a
placeholder someone left for exactly this feature. That makes it a good place
to put an answer, and no help in working one out.

## Three ways to get the duration

**A. Parse it at build time into `endtrigger`.** Cheap for the clear cases —
the 20 round-scale and 255 scene-long charms match on a handful of phrases.
Wrong for the rest, and silently so: a charm whose text happens to mention a
scene for an unrelated reason gets a duration it does not have. Viable only
with the output reviewed, the way the prerequisite linking was.

**B. Let the table mark it.** The panel shows what is active and a button to
drop it. No parsing, no false positives, and the player decides. The cost is
that nothing is automatic.

**C. Remind rather than expire.** At end of turn, list what is running and
what each charm's own text says about how long. Never wrong, never automatic.

## What I would build

**B, with C's wording, and A only for the 20.**

A **Running** block in the panel, visible when the character has any active
charm:

- One row per active charm: name, what it cost, and — where the build step
  found one — its duration in the charm's own words.
- A drop button per row, calling `actor.spendItem(item)` so the system does the
  reversal. Committed motes come back and the charm's ActiveEffects are
  disabled, all through the code that already handles it. The panel must not
  write `system.active` itself.
- Committed motes shown as a total, since that is the number that quietly eats
  a character's pool over a session.
- At scene end, a single sweep: "these 4 charms say they last for the scene —
  drop them?" There is no scene-end hook in Foundry, so this hangs off ending
  the combat, plus a button.

The twenty round-scale charms get `endtrigger` set at build time and a
one-line prompt at end of turn. Twenty is few enough to check by hand.

## What would make this wrong

- **Charms that end on something other than time.** Several end when the
  character is hit, or when they move. A duration field cannot express that and
  should not pretend to.
- **Committed motes are not a duration.** A commitment lasts until released,
  which may be days. Sweeping them at scene end would be wrong.
- **Expiring anything automatically.** Dropping a charm the player still wanted
  is worse than leaving one running: they notice the second and not the first.
  Every drop should be a button someone presses.
