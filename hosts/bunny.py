"""Bunny.net storage + CDN backend.

The option for people who do not want to move their nameservers. Bunny issues its own
hostname you point a single CNAME at, so your domain stays exactly where it is — unlike an
R2 custom domain, which requires the zone to live in the same Cloudflare account.

.env:  BUNNY_STORAGE_ZONE, BUNNY_ACCESS_KEY, BUNNY_REGION (optional), BUNNY_PUBLIC_BASE
"""
import urllib.request

REQUIRED = ["BUNNY_STORAGE_ZONE", "BUNNY_ACCESS_KEY", "BUNNY_PUBLIC_BASE"]


def put(env, key, path, content_type):
    region = env.get("BUNNY_REGION", "")
    host = f"{region}.storage.bunnycdn.com" if region else "storage.bunnycdn.com"
    url = f"https://{host}/{env['BUNNY_STORAGE_ZONE']}/{key}"
    req = urllib.request.Request(url, data=path.read_bytes(), method="PUT")
    req.add_header("AccessKey", env["BUNNY_ACCESS_KEY"])
    req.add_header("Content-Type", content_type)
    with urllib.request.urlopen(req, timeout=120) as r:
        if r.status not in (200, 201):
            raise RuntimeError(f"Bunny returned {r.status} for {key}")
    return f"{env['BUNNY_PUBLIC_BASE'].rstrip('/')}/{key}"
