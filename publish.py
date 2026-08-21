#!/usr/bin/env python3
"""Upload rendered audio + artwork, then rebuild the feed against the real URLs.

    python3 publish.py assets    # episodes + cover art
    python3 publish.py feed      # feed.xml only (after: node generate.mjs --feed-only)
    python3 publish.py all       # assets, rebuild feed, upload feed

The order matters and is not arbitrary. Enclosure URLs are only known after upload, so the
sequence is always: upload audio -> write hosted.json -> rebuild feed -> upload feed. Build
the feed first and it will carry URLs for files that are not there yet.

Backend comes from host.provider in show.config.json (r2, bunny, s3, local).
"""
import importlib
import json
import pathlib
import subprocess
import sys
import urllib.request

HERE = pathlib.Path(__file__).parent
OUT, ASSETS = HERE / "output", HERE / "assets"

TYPES = {".mp3": "audio/mpeg", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".png": "image/png", ".xml": "application/rss+xml"}


def env():
    e = {}
    f = HERE / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                e[k.strip()] = v.strip().strip('"').strip("'")
    return e


def backend():
    cfg = json.loads((HERE / "show.config.json").read_text())
    name = cfg.get("host", {}).get("provider", "r2")
    mod = importlib.import_module(f"hosts.{name}")
    e = env()
    missing = [k for k in mod.REQUIRED if not e.get(k)]
    if missing:
        sys.exit(f"host.provider is \"{name}\" but .env is missing: {', '.join(missing)}\n{mod.__doc__}")
    return mod, e, cfg


def upload(mod, e, key, path):
    url = mod.put(e, key, path, TYPES.get(path.suffix.lower(), "application/octet-stream"))
    print(f"  ↑ {key:44} {path.stat().st_size:>9,} B")
    return url


def do_assets(mod, e, cfg):
    hosted_path = OUT / "hosted.json"
    hosted = json.loads(hosted_path.read_text()) if hosted_path.exists() else {}
    for d in sorted(OUT.iterdir()):
        mp3 = d / "episode.mp3"
        if d.is_dir() and mp3.exists():
            hosted[d.name] = upload(mod, e, f"{d.name}/episode.mp3", mp3)
    # 🔴 Artwork filename is versioned deliberately. Apple caches art by filename, and a CDN
    # in front of the bucket keeps serving the old object even after you overwrite the key.
    # Bump the -vN when the image changes; do not rely on a purge.
    covers = sorted(ASSETS.glob("cover-*.jpg")) + sorted(ASSETS.glob("cover-*.png"))
    if covers:
        hosted["_cover"] = upload(mod, e, covers[-1].name, covers[-1])
    hosted_path.parent.mkdir(parents=True, exist_ok=True)
    hosted_path.write_text(json.dumps(hosted, indent=2))
    print(f"\n  hosted.json updated ({len(hosted)} entries)")


def do_feed(mod, e, cfg):
    feed = OUT / "feed.xml"
    if not feed.exists():
        sys.exit("No output/feed.xml — run `node generate.mjs --feed-only` first.")
    url = upload(mod, e, "feed.xml", feed)
    hosted_path = OUT / "hosted.json"
    hosted = json.loads(hosted_path.read_text()) if hosted_path.exists() else {}
    # Persist the real self URL so the next feed build stamps <atom:link rel="self"> correctly.
    hosted["_feedSelf"] = url
    hosted_path.write_text(json.dumps(hosted, indent=2))
    print(f"\n  Feed: {url}")
    print(f"  Verify before submitting:  node preflight.mjs {url}")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    mod, e, cfg = backend()
    if cmd in ("assets", "all"):
        do_assets(mod, e, cfg)
    if cmd == "all":
        subprocess.run(["node", str(HERE / "generate.mjs"), "--feed-only"], check=True)
    if cmd in ("feed", "all"):
        do_feed(mod, e, cfg)


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    main()
