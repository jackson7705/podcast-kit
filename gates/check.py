#!/usr/bin/env python3
"""Voice gate. Deterministic, no model involved.

This is the point of the whole writing loop: it gives an agent a FAILING TEST to iterate
against, so the quality of the output stops depending on how good the model is on the day.
A weaker model just loops more times.

    python3 gates/check.py                 # every episode
    python3 gates/check.py episodes/01-x.mdx

Exit code 0 only when nothing is flagged. Nothing here is a law — patterns.json is the
show's taste and you should edit it. What matters is that the check can actually fail.
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent
P = json.loads((HERE / "patterns.json").read_text())


def body_of(path):
    raw = path.read_text()
    parts = raw.split("---", 2)
    return parts[2] if len(parts) > 2 else raw


def check(path, target_ratio=None):
    b = body_of(path)
    flags = []

    for name, rx in P["slop"]:
        n = len(re.findall(rx, b, re.I))
        if n:
            flags.append(f"{name}x{n}")
    for rx in P["taboo"]:
        if re.search(rx, b, re.I):
            flags.append(f"TABOO:{rx[:20]}")
    for rx in P["guarantee"]:
        if re.search(rx, b, re.I):
            flags.append("GUARANTEE")
    if P["tts"]["em-dash"] in b:
        flags.append(f"EM-DASHx{b.count(P['tts']['em-dash'])}")

    we = len(re.findall(r"(?i)\b(we|our|us|we're|we've|we'd|we'll)\b", b))
    you = len(re.findall(r"(?i)\b(you|your|you're|you've|you'd|you'll)\b", b))
    ratio = we / max(you, 1)

    words = len(re.findall(r"[A-Za-z']+", b))
    longest = max((len(re.findall(r"[A-Za-z']+", p)) for p in b.split("\n\n")), default=0)
    if longest > 90:
        flags.append(f"LONG-PARA({longest}w)")

    return {"file": path.name, "words": words, "we": we, "you": you, "ratio": ratio, "flags": flags}


def main():
    targets = [pathlib.Path(a) for a in sys.argv[1:]] or sorted((ROOT / "episodes").glob("*.mdx"))
    if not targets:
        sys.exit("No episodes found.")
    print(f"  {'episode':34} {'words':>5} {'we':>3} {'you':>4} {'ratio':>6}  flags")
    bad = 0
    for t in targets:
        r = check(t)
        if r["flags"]:
            bad += 1
        print(f"  {r['file'][:34]:34} {r['words']:5} {r['we']:3} {r['you']:4} {r['ratio']:6.2f}  "
              f"{' · '.join(r['flags']) if r['flags'] else 'clean'}")
    print()
    if bad:
        print(f"  {bad}/{len(targets)} episode(s) flagged. Fix, then re-run. Nothing renders until this is clean.\n")
        sys.exit(1)
    print(f"  {len(targets)}/{len(targets)} clean.\n")


if __name__ == "__main__":
    main()
