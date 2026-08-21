# podcast-kit

Turn the posts you already have into a podcast, and end up with an RSS feed URL you can
paste into Apple Podcasts and Spotify.

Node 18+ and `ffmpeg`. No npm install. One API key, and only if you want a good voice.

```
your blog  →  ingest  →  your AI writes the scripts  →  TTS  →  ffmpeg  →  feed.xml  →  a URL
```

Three shows and thirty-odd episodes have shipped through this pipeline and are live on
Apple and Spotify. Most of what is in here is the debugging, not the wiring.

---

## Why the writing step has no API key

podcast-kit does not call a language model. Anywhere.

The writing step — reading a post and turning it into a script — is done by **your own
Claude Code or Codex session**, against the contract in [AGENTS.md](AGENTS.md), which both
read automatically. You are already paying for that subscription. Adding a second metered
API key to do the same work is a tax on nothing.

What makes this work rather than just shifting the problem is [`gates/check.py`](gates/check.py):
a deterministic pass over the scripts that the agent has to get to zero before anything
renders. A failing test, not a vibe check. A weaker model just loops more.

```
write → gate fails → fix → gate passes → render
```

The audio half is fully scriptable and needs no agent at all, so you can also just write
the `.mdx` files yourself.

---

## Try it first, with no keys at all

```bash
cp demo/show.config.json .
cp demo/episodes/*.mdx episodes/
node generate.mjs
```

That renders a real episode and writes `output/feed.xml`. No API key, no account, no network.
It uses the `local` TTS provider, so it sounds like a robot — that is the point: you get to
hear the shape of the show before deciding whether a good voice is worth paying for.

## Quick start

```bash
cp show.config.example.json show.config.json   # read the notes in it, they matter
cp .env.example .env

node ingest.mjs --from https://yoursite.com/feed --limit 20
```

Then, in Claude Code or Codex: **"read AGENTS.md and write episodes 1 to 5 from sources/"**

```bash
python3 gates/check.py        # must be clean
node setup-check.mjs          # what is missing, and the exact fix
node generate.mjs --dry-run   # validates every script, no key needed
node generate.mjs             # render
python3 publish.py all        # upload, rebuild feed against real URLs, upload feed
node preflight.mjs            # ← the point of the whole thing
```

`preflight` prints the feed URL only when it would survive submission. Then paste it into
[podcastsconnect.apple.com](https://podcastsconnect.apple.com) and
[creators.spotify.com](https://creators.spotify.com).

---

## preflight

Not an XML validator — [castfeedvalidator.com](https://castfeedvalidator.com) already tells
you whether the XML parses. Every check in `preflight.mjs` is something that **passes generic
validation and still breaks**, collected from feeds that actually failed:

- Every `<enclosure>` HEAD 200, `audio/*`, and `length` matching the real byte count. A
  mismatch means the feed was built before the last render — apps show the wrong duration
  or refuse to scrub.
- `<atom:link rel="self">` equals the URL you are submitting. Left stale after a host move,
  Podcasts Connect answers only *"An error has occurred. Try again later."*
- No `pubDate` in the future. Staggering a season forward hides every episode past today,
  and nothing tells you.
- Artwork reachable, square, 1400–3000px, RGB JPEG/PNG, and **HEAD allowed**.
- The feed URL serves XML, not an HTML error page. WordPress media rejects `.xml` uploads,
  which is how that one usually happens.
- `<itunes:email>` present — Spotify mails the ownership code there and there is no other way in.

It works on any feed URL, including ones podcast-kit did not build.

---

## Hosting

**Your feed URL is a one-way door.** Apple and Spotify poll one URL for the life of the
show. Moving later means a change-of-address dance and risking the listing. So put it on a
domain you control on day one — this is the decision to spend ten minutes on.

| provider | when |
|---|---|
| **`r2`** | **Default.** Cloudflare R2 with a custom domain. Zero egress fees, which is exactly the shape of podcast hosting, and overwrite-in-place keeps every URL stable. The domain must be a zone in the same Cloudflare account — you can keep it registered at GoDaddy or Namecheap and just point the nameservers at Cloudflare's free plan. |
| `bunny` | You would rather not move nameservers. Bunny issues a hostname you point one CNAME at. |
| `s3` | You are already on AWS. Put a CDN in front or egress will cost you. |
| `local` | Stages to `output/_upload/`; copy it anywhere. |

Not recommended for a real show: the `r2.dev` development URL, which Cloudflare
[rate-limits and marks as non-production](https://developers.cloudflare.com/r2/buckets/public-buckets/),
and any `*.github.io` host — a URL you will want to leave.

---

## TTS

Four providers. Two are specific, two are generic — and the generic pair is how you use a
local model without anyone writing an adapter for it.

| provider | for |
|---|---|
| `elevenlabs` | The hosted one. `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`. Clone **only a voice you have the rights to.** |
| `local` | Zero setup. [Piper](https://github.com/rhasspy/piper) via `PIPER_MODEL`, else macOS `say` via `SAY_VOICE` (`say -v "?"` lists them). |
| `command` | **Any local model with a CLI.** |
| `openai` | **Any OpenAI-compatible `/v1/audio/speech` server**, which is what most local TTS servers expose. |

There is no "voice id" for a local model. Piper takes a path to a `.onnx` file you
downloaded; `say` takes the name of a voice on the machine; Kokoro takes a voice name baked
into the model. None of it is a secret or tied to an account.

### Using any local model — `command`

```json
"tts": {
  "provider": "command",
  "command": "kokoro-tts {{text_file}} {{out}} --voice af_heart",
  "outputFormat": "wav"
}
```

`{{text_file}}` is a temp file holding one paragraph, `{{out}}` is where your tool must write
audio, `{{text}}` inlines the text shell-quoted instead. Use none of them and the text
arrives on stdin. Whatever format your tool writes gets converted to mp3 here. The command
runs through `sh -c`, so pipes work.

That is the whole integration. No adapter, no PR, no wait for this repo to catch up with a
model list that turns over every few months.

### Using a local server — `openai`

```json
"tts": {
  "provider": "openai",
  "baseUrl": "http://localhost:8880/v1",
  "model": "kokoro",
  "voice": "af_heart"
}
```

Works against Kokoro-FastAPI, LocalAI, Speaches, or OpenAI itself. Set `TTS_API_KEY` only if
your endpoint wants one; a local server usually does not.

### Which local model

**Check the license before you ship a commercial show** — this is where people get caught,
not on quality. As widely reported (verify on the model card yourself, licenses change):

| model | license | notes |
|---|---|---|
| **Kokoro-82M** | Apache 2.0 | The usual default. 82M params, runs on a laptop CPU, many voices. |
| **Piper** | MIT | Fast, small, lots of prebuilt voices. Has a first-class provider here. |
| **Chatterbox** | MIT | Does voice cloning, permissively licensed. Wants a GPU. |
| **StyleTTS 2** | MIT | Strong quality, more setup. |
| **XTTS v2** | ⚠️ CPML — **non-commercial** | Coqui shut down in 2024. Good at cloning, and the most common licensing mistake in this space. |
| **F5-TTS** | ⚠️ CC-BY-NC — **non-commercial** | Same trap. |

Not TTS at all, despite showing up in "local speech models" lists: **Whisper** and **NVIDIA
Parakeet** are speech-*to*-text.

### Why the ElevenLabs default is `eleven_multilingual_v2`

`eleven_v3` sounds better in isolation but rejects `previous_text`/`next_text`, and this
pipeline synthesises one chunk per paragraph — so under v3 every chunk starts cold and a
cloned voice audibly drifts in timbre across an episode. Continuity beats per-chunk polish
once you are chunking.

## Things this repo knows that cost someone a day

- **A long single generation drifts.** One measured body decayed 18 dB start to finish. So
  synthesis is per paragraph, each chunk level-matched, joined with a 0.45s beat, with
  prosody context across the seams so you cannot hear the joins.
- **Two voice clones do not render at the same loudness.** Two measured on identical
  settings came out 6.5 dB apart, and the quieter one sat underneath its own theme music.
  So the mix measures the voice and lifts it to a target instead of trusting a fixed gain.
- **Music overlaps and ducks; it never hard-cuts.** The intro plays solo, then fades under
  the first line. `overlapIn`/`overlapOut` in config are tuned to the fade envelopes in the
  music itself — change one, change the other.
- **Version your artwork filename.** Apple caches art by filename, and a CDN in front of
  your bucket keeps serving the old object after you overwrite the key. Bump `-vN`; do not
  trust a purge.
- **Never publish an episode at a URL that can collide with an existing page.** Slug
  collisions on a CMS overwrite live pages.

---

## Layout

```
AGENTS.md              the writing contract — your agent reads this
show.config.json       everything show-specific. No show detail belongs in code.
pronunciations.json    spoken-form fixes applied to TTS input only
voice.md               optional: your show's register, read by the writing step

ingest.mjs   ingest/   posts → sources/*.txt      (rss · sitemap · wordpress · local)
             episodes/ *.mdx                       ← written by your agent
gates/       check.py  the failing test
generate.mjs tts/      TTS → mix → output/feed.xml (elevenlabs · local)
publish.py   hosts/    upload + rebuild feed       (r2 · bunny · s3 · local)
preflight.mjs          validate the live feed, print the URL
```

MIT. Contributions welcome, particularly host and TTS adapters.
