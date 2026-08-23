# Implementation Report: AirSense main-domain podcast hosting

## Status

The production hosting path and first three source-grounded episodes are live and validated.
Directory distribution is underway; several publisher portals still require human email,
CAPTCHA, or channel-selection steps.

## Implemented

- Configured podcast-kit to emit the show page, feed, artwork, and audio URLs under
  `https://airsenseenvironmental.com/podcast/`.
- Added a generic read-only Cloudflare Worker with WordPress origin fallback, R2 streaming, HEAD,
  cache metadata, and byte-range support.
- Added seven deterministic Worker tests and a Wrangler dry-run configuration.
- Created the Cloudflare R2 bucket `airsense-podcast` and Worker
  `airsense-podcast-main-domain` in the Growth Pro Agency account.
- Bound the Worker to the dedicated bucket, added route
  `airsenseenvironmental.com/podcast/*`, and disabled the public `workers.dev` URL.
- Created a least-privilege publisher credential scoped to object read/write on only the dedicated
  podcast bucket and stored it in the ignored, mode-600 `.env` file.
- Published the approved versioned cover image, three episode audio files, and the canonical RSS
  feed.
- Added an isolated Python publisher environment, pinned `boto3`, and taught setup/secret checks to
  handle that environment correctly.
- Added `Last-Modified` response metadata for Apple Podcasts artwork and enclosure compatibility.
- Wrote and gated three episodes grounded in Air Sense articles:
  - `01-what-to-do-after-a-high-radon-test.mdx`
  - `02-are-diy-radon-test-kits-accurate.mdx`
  - `03-how-long-should-you-test-for-radon.mdx`
- Created `distribution.md` as the launch tracker and documented which supplied services are direct
  submission targets, downstream directories, or unrelated hosting/consumer services.

## Production Verification

- `/podcast/` returns the existing WordPress page with HTTP 200.
- An unknown `/podcast/...` key falls through to the WordPress 404.
- The cover URL returns HTTP 200 with `image/png`, its full content length, ETag, cache policy, and
  `Accept-Ranges: bytes`.
- An explicit `Range: bytes=0-31` request returns HTTP 206 and a correct `Content-Range`.
- The live cover SHA-256 exactly matches the local approved asset.
- `/podcast/feed.xml` returns HTTP 200 and contains three episodes.
- Live feed preflight passes channel metadata, artwork, landing-page, enclosure, and publication-date
  checks.
- Podcast Index, Pocket Casts, and Podcast Addict have public listings containing the launch
  episodes.
- Spotify has a public listing containing all three launch episodes at
  `https://open.spotify.com/show/6xbJBLh02mrCdnZCHQNbC4`.
- Apple Podcasts accepted and published the show at
  `https://podcasts.apple.com/us/podcast/st-louis-radon-answers-by-air-sense-environmental/id6804342756`.
- Spotify, Amazon Music/Audible, Deezer, and iHeartRadio accepted the feed far enough to begin their
  ownership-verification workflows.

## Validation

- `npm --prefix worker run check`: pass (7/7 tests plus Wrangler dry run).
- `node setup-check.mjs`: pass.
- `bash scripts/check-secrets.sh`: pass.
- `uv pip check --python .venv/bin/python`: pass.
- `git diff --check`: pass.
- `python3 gates/check.py`: pass for all three episodes.
- `node preflight.mjs https://airsenseenvironmental.com/podcast/feed.xml`: pass for all three
  enclosures.

## Remaining Launch Work

1. Complete the emailed ownership steps for Spotify, Amazon Music/Audible, Deezer, Anghami, Castbox,
   and JioSaavn.
2. Complete the iHeartRadio CAPTCHA and final submission form.
3. Switch YouTube Studio to an Air Sense Environmental channel before importing the RSS feed.
4. Submit to the remaining independent directories listed in `distribution.md`, then recheck the
   downstream catalogs after Apple and Podcast Index propagation.
