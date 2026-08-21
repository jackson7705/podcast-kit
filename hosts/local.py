"""Local backend: stages everything into output/_upload/ with the exact key layout the feed
expects, and stops. Copy that tree to any static host you like.

You still have to set PUBLIC_BASE so the feed knows what the URLs will be. Getting this
wrong is the single most common way to ship a feed full of dead enclosures.

.env:  PUBLIC_BASE
"""
import shutil

REQUIRED = ["PUBLIC_BASE"]


def put(env, key, path, content_type):
    from pathlib import Path
    dest = Path(__file__).resolve().parent.parent / "output" / "_upload" / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dest)
    return f"{env['PUBLIC_BASE'].rstrip('/')}/{key}"
