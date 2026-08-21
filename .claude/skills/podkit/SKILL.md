---
name: podkit
description: Build a podcast from existing blog posts and get a submittable RSS feed URL. Use when the user wants to turn articles into podcast episodes, write episode scripts from source posts, render audio with TTS, or validate a podcast feed before submitting it to Apple or Spotify.
---

# podkit

The full writing contract is in [AGENTS.md](../../../AGENTS.md) at the repo root. **Read it
before writing any episode.** Do not restate or summarise it here; there is one copy on
purpose.

## Order of operations

1. `node ingest.mjs --from <feed url>` — fetches posts into `sources/`.
2. Read `show.config.json`, `voice.md` if present, and `sources/index.json`.
3. Propose which sources become episodes and which do not, with reasons, before writing.
4. Write `episodes/NN-slug.mdx` per AGENTS.md.
5. `python3 gates/check.py` — iterate until it exits 0. Never render past a flag.
6. `node generate.mjs --dry-run`, then `node generate.mjs`.
7. `python3 publish.py all`, then `node preflight.mjs`.

## Rules that override anything else

- **Never invent a fact, price, date, statistic or claim.** Everything traces to the
  episode's `sourceArticle`. If it is not in the source, ask.
- **Never write `duration:`** — the renderer measures and writes it back.
- **Never change a published `slug`** — it is the guid directories key on.
- **Never set `publishedAt` in the future** — Apple and Spotify hide those episodes silently.
- **Do not work around `gates/check.py` by rephrasing until the regex stops matching.** Fix
  the writing, or change `gates/patterns.json` and say that you did.
