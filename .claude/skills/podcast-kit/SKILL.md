---
name: podcast-kit
description: Turn a blog or website into a published podcast — pick posts, write episode scripts, render audio, host it, and produce an RSS feed URL ready to submit to Apple Podcasts and Spotify. Use when someone wants to start a podcast from existing content, turn articles into audio episodes, write or fix podcast scripts, or check whether a podcast feed is ready to submit.
---

# podcast-kit

Takes someone from "I have a blog" to "here is my feed URL, paste it into Apple Podcasts."

**Assume the person is not technical unless they show otherwise.** Run the commands yourself.
Never paste raw terminal output at them — read it and tell them what it means. Never ask them
to edit JSON; ask the question in plain words and edit the file for them.

Requires Claude Code or another agent with a real shell and filesystem. It cannot work in a
browser-only chat: the pipeline needs `ffmpeg`, writes files, and uploads them.

---

## 0. Bootstrap

Find the repo before doing anything else.

- If the working directory contains `generate.mjs` and `AGENTS.md`, you are in it. Continue.
- Otherwise look for a checkout (`~/podcast-kit`, `~/Documents/podcast-kit`, or ask).
- If there is none, offer to clone it:
  `git clone https://github.com/ankurmans/podcast-kit ~/podcast-kit`

Then run `node setup-check.mjs` and fix what it reports. It prints the exact fix for each
problem. On macOS, `brew install ffmpeg` is the usual one — offer to run it.

**Read `AGENTS.md` before writing any episode.** It is the writing contract and this file
deliberately does not repeat it.

---

## 1. Decide what the show is

Ask, conversationally, and write the answers into `show.config.json` yourself:

- **Whose site is it, and what's the URL?**
- **What should the show be called?** Warn them that Apple and Spotify title search is
  keyword-literal, so a plain descriptive name gets found and a clever one has to earn its
  audience. **Check the name is not taken** before committing to it — a show that already owns
  the name owns their brand search too.
- **Who is the audience?** Their customers, their peers, or both.
- **What should the last line of every episode say?** One destination, no invented offer.
- **What email do they actually read?** Spotify sends the ownership code there. Say so.

---

## 2. Get the source material

`node ingest.mjs --from <their rss or sitemap url> --limit 25`

If that finds nothing, try `--source sitemap`, then `--source wordpress`. Report what came
back in plain language: how many posts, what they are about.

---

## 3. Choose the episodes, then write them

**Propose a list before writing anything**, with the source each episode maps to and why.
Include what you are leaving out and why — thin posts, and anything that would commit them to
a price out loud. Get agreement, then write.

Then write `episodes/NN-slug.mdx` per `AGENTS.md`, and loop:

```
python3 gates/check.py     # must exit 0
```

**Never render past a flag, and never beat the gate by rephrasing until the regex stops
matching.** Fix the writing, or change `gates/patterns.json` deliberately and say that you did.

---

## 4. Render

`node generate.mjs --dry-run`, then `node generate.mjs`.

The default voice is a free local one, so this costs nothing and needs no account. Play them
episode one before rendering the rest. If they want it to sound like a person, that is
ElevenLabs — explain it is a paid account, and that cloning a voice means a voice they have
the right to clone.

---

## 5. Hosting — the part that needs them

Everything so far ran on their machine. Publishing needs somewhere public, and this is the
one step you cannot do for them.

**Tell them plainly: the feed URL is permanent.** Apple and Spotify poll one URL for the life
of the show, so moving later is painful. That is why it goes on a domain they own rather than
whatever is quickest.

Default is Cloudflare R2. Walk them through it and **verify each step rather than trusting
it**: bucket created, custom domain attached and Active, API token with Object Read & Write,
values in `.env`. Then `python3 publish.py all` and read the result back to them.

Two things to say out loud:
- Their domain can stay registered wherever it is. Only the nameservers move to Cloudflare,
  which is free. Check the imported DNS records — **especially MX** — before they switch, or
  their email breaks.
- Do not launch on an `r2.dev` URL. Cloudflare rate-limits it and it is not for production.

If they refuse to touch DNS, `host.provider: "bunny"` needs only one CNAME.

---

## 6. Preflight, then submit

`node preflight.mjs`

It checks the live feed for the things that pass every validator and still get a show
rejected. **Do not let them submit until it is clean.** Explain each failure in plain terms —
"three of your episodes are dated next month, so nobody will see them" beats quoting the tag.

When it clears, give them the feed URL and where it goes:
- Apple: podcastsconnect.apple.com → add a show → paste the feed
- Spotify: creators.spotify.com → add podcast → paste the same feed, verify by the emailed code
- Then Podcast Index, Listen Notes, Podchaser, YouTube Music, Amazon — most of the rest
  auto-ingest from Apple.

---

## Rules that override anything else

- **Never invent a fact, price, date, statistic or claim.** Everything traces to that
  episode's `sourceArticle`. If it is not in the source, ask.
- **Never write `duration:`** — the renderer measures and writes it back.
- **Never change a published `slug`** — directories key episodes on it.
- **Never set `publishedAt` in the future** — Apple and Spotify hide those episodes silently,
  and nothing tells you.
- **Never put an API key in `show.config.json`.** Keys go in `.env`, which is gitignored.
