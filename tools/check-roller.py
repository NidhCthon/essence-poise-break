"""Watch the part of the Exalted Essence roller that this module mirrors.

`targetNumbers()` in scripts/turn-panel.js reproduces the modifiers the
system's roller applies to a target: prone, surprised, cover, concealment,
grappling and the wound penalty. That duplication is deliberate - the panel
has to predict the roll before the roller runs - but it means the module can
fall out of step when the system changes.

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


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8")


def extract(source):
    """The condition block, plus the wound line, with whitespace normalised."""
    start = source.find(ANCHOR)
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
    block = source[start:end]
    wound = WOUND.search(source)
    if wound:
        block += "\n" + wound.group(0)
    # Whitespace-only edits are not drift.
    return re.sub(r"\s+", " ", block).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update", action="store_true",
                        help="record the current block as the expected one")
    args = parser.parse_args()

    block = extract(fetch(SOURCE))
    if block is None:
        print("FAIL: could not find the condition block in the roller.")
        print("The system has been restructured; check targetNumbers() by hand.")
        print(SOURCE)
        return 1

    digest = hashlib.sha256(block.encode("utf-8")).hexdigest()

    if args.update:
        BASELINE.write_text(json.dumps(
            {"sha256": digest, "source": SOURCE, "block": block}, indent=2
        ) + "\n", encoding="utf-8")
        print("recorded {}".format(digest[:16]))
        return 0

    if not BASELINE.exists():
        print("FAIL: no baseline. Run with --update once.")
        return 1

    expected = json.loads(BASELINE.read_text(encoding="utf-8"))
    if expected["sha256"] == digest:
        print("unchanged ({})".format(digest[:16]))
        return 0

    print("CHANGED: the roller's condition handling is no longer what this "
          "module mirrors.")
    print()
    print("was:", expected["block"][:600])
    print()
    print("now:", block[:600])
    print()
    print("Check targetNumbers() in scripts/turn-panel.js, update it if a "
          "modifier moved, then re-record with --update.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
