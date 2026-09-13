"""Watch the part of the Exalted Essence roller that this module mirrors.

The panel reproduces two pieces of the system's roller, because it has to
say what a roll needs before the roller runs:

* `targetNumbers()` mirrors the modifiers applied to a target - prone,
  surprised, cover, concealment, grappling and the wound penalty.
* `socialNumbers()` and the social block mirror how influence resolves
  against Resolve, including that none of those modifiers apply to it.
* `GAMBITS` mirrors the roller's own gambit cost table. The panel opens the
  roller with a gambit already chosen, and the roller recomputes the cost only
  when the choice *changes* - so the panel's number is the one that is spent.

That duplication is deliberate, but it means the module can fall out of step
when the system changes.

This extracts that block from the system's source and compares it with a
fingerprint committed alongside. Run it on a schedule and a change upstream
becomes an email, rather than a player noticing the advice is a point out.

    python tools/check-roller.py            # check, exit 1 on a change
    python tools/check-roller.py --update   # re-record after adjusting the module

Exit codes: 0 unchanged, 1 changed or the block could not be found.
"""
import argparse
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

SOURCE = ("https://raw.githubusercontent.com/Aliharu/Foundry-ExEss/master/"
          "module/apps/dice-roller.js")
BASELINE = Path(__file__).resolve().parent.parent / ".roller-watch.json"

# Where the roller inspects the target's conditions.
ANCHOR = "if (this.object.target.actor.effects) {"
# Applied just after that block, and mirrored too.
WOUND = re.compile(r"^.*this\.object\.defense\s*-=\s*this\.object\.target\.actor"
                   r"\.system\.health\.penalty.*$", re.M)

# Where the roller decides which of the target's numbers is its Defense.
# This is not part of the condition block below it, and the panel got it
# wrong for every character target until it was watched.
DEFENCE_ANCHOR = "if (this.object.target.actor.type === 'npc') {"

# What the roller charges for each gambit. The first of the two copies in
# the file is the live one, inside myFormHandler; the other sits in an
# activateListeners left over from ApplicationV1 and never runs.
GAMBIT_ANCHOR = "const gambitCosts = {"

# How influence resolves, and where Resolve is taken from the target.
SOCIAL_ANCHOR = "_socialInfluence() {"
SOCIAL_SOURCE = re.compile(
    r"^.*this\.object\.resolve\s*=\s*this\.object\.target\.actor"
    r"\.system\.resolve\.value.*$", re.M)


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8")


def braced_block(source, anchor):
    """The text from an anchor to the brace that closes it."""
    start = source.find(anchor)
    if start == -1:
        return None
    depth, end = 0, None
    for i in range(start, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        return None
    return source[start:end]


def normalise(text):
    """Whitespace-only edits are not drift."""
    return re.sub(r"\s+", " ", text).strip()


def extract(source):
    """Each watched block, by name, or None if one cannot be found."""
    blocks = {}

    conditions = braced_block(source, ANCHOR)
    if conditions is None:
        return None
    wound = WOUND.search(source)
    if wound:
        conditions += "\n" + wound.group(0)
    blocks["conditions"] = normalise(conditions)

    defence = braced_block(source, DEFENCE_ANCHOR)
    if defence is None:
        return None
    # The else branch is the half that applies to characters, so take the
    # whole if/else rather than just the npc arm.
    after = source[source.find(DEFENCE_ANCHOR) + len(defence):]
    else_block = braced_block(after, "else {")
    if else_block:
        defence += " " + else_block
    blocks["defence"] = normalise(defence)

    social = braced_block(source, SOCIAL_ANCHOR)
    if social is None:
        return None
    source_line = SOCIAL_SOURCE.search(source)
    if source_line:
        social += "\n" + source_line.group(0)
    blocks["social"] = normalise(social)

    gambits = braced_block(source, GAMBIT_ANCHOR)
    if gambits is None:
        return None
    blocks["gambits"] = normalise(gambits)

    return blocks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update", action="store_true",
                        help="record the current block as the expected one")
    args = parser.parse_args()

    blocks = extract(fetch(SOURCE))
    if blocks is None:
        print("FAIL: could not find a watched block in the roller.")
        print("The system has been restructured; check targetNumbers() and "
              "the social block by hand.")
        print(SOURCE)
        return 1

    digests = {name: hashlib.sha256(text.encode("utf-8")).hexdigest()
               for name, text in blocks.items()}

    if args.update:
        BASELINE.write_text(json.dumps(
            {"source": SOURCE,
             "blocks": {name: {"sha256": digests[name], "block": blocks[name]}
                        for name in blocks}},
            indent=2) + "\n", encoding="utf-8")
        for name in sorted(digests):
            print("recorded {:11s} {}".format(name, digests[name][:16]))
        return 0

    if not BASELINE.exists():
        print("FAIL: no baseline. Run with --update once.")
        return 1

    expected = json.loads(BASELINE.read_text(encoding="utf-8"))
    if "blocks" not in expected:
        print("FAIL: the baseline predates the social block being watched.")
        print("Check the module still matches the roller, then re-record "
              "with --update.")
        return 1

    what = {"conditions": "targetNumbers() in scripts/turn-panel.js",
            "defence": "the baseDefense branch in targetNumbers()",
            "social": "socialNumbers() and the social block",
            "gambits": "the GAMBITS table in scripts/turn-panel.js"}
    changed = [name for name in blocks
               if expected["blocks"].get(name, {}).get("sha256")
               != digests[name]]
    if not changed:
        print("unchanged ({})".format(
            " ".join("{} {}".format(n, digests[n][:8]) for n in sorted(blocks))))
        return 0

    for name in changed:
        print("CHANGED: {} is no longer what this module mirrors.".format(name))
        print()
        print("was:", expected["blocks"].get(name, {}).get("block", "")[:500])
        print()
        print("now:", blocks[name][:500])
        print()
        print("Check {}, update it if the rule moved, then re-record with "
              "--update.".format(what.get(name, "the panel")))
        print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
