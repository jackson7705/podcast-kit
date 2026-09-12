# podcast-kit

Turn the posts you already have into a podcast, and end up with an RSS feed URL you can
paste into Apple Podcasts and Spotify.

Node 18+ and `ffmpeg`. No npm install. Real shows default to NotebookLM Audio Overviews;
the keyless local provider remains available for the demo.

```
your blog  →  ingest  →  episode manifests  →  NotebookLM podcast  →  ffmpeg  →  feed.xml  →  a URL
```

Three shows and thirty-odd episodes have shipped through this pipeline and are live on
Apple and Spotify. Most of what is in here is the debugging, not the wiring.

---

## Why NotebookLM is the default

Text-to-speech can only perform the words it receives. A better voice can make an article
sound nicer, but it cannot turn that article into a conversation. The `notebooklm` provider
sends the source material to NotebookLM as a whole and downloads its Audio Overview: hosts
explaining, reacting, and asking each other the questions a listener would ask.

Claude Code or Codex still chooses the source and writes the episode metadata against the
contract in [AGENTS.md](AGENTS.md). NotebookLM writes and performs the conversation from the
matching local source captured by `ingest.mjs`. Literal providers remain available only when
an exact approved script is required.

This uses the unofficial [`notebooklm-py`](https://github.com/jackson7705/notebooklm-py)
client requested for this repository. It automates the signed-in NotebookLM product; it is
not an official Google API and can change when NotebookLM changes.

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

uv tool install "notebooklm-py[browser] @ git+https://github.com/jackson7705/notebooklm-py.git"
notebooklm login

node ingest.mjs --from https://yoursite.com/feed --limit 20

python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Then, in Claude Code or Codex: **"read AGENTS.md and create episode manifests 1 to 5 from sources/"**

```bash
notebooklm auth check --test --passive
node setup-check.mjs          # what is missing, and the exact fix
node generate.mjs --dry-run   # validates metadata without generation/quota use
node generate.mjs             # create Audio Overviews, download, and mix
.venv/bin/python publish.py all  # upload, rebuild feed against real URLs, upload feed
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

## Optional daily automation

`automation/weekly.mjs` is the opt-in unattended mode used by the Air Sense deployment.
It checks the source RSS feed daily, publishes at most one new suitable article, and
uses the live podcast feed plus an R2 watermark to prevent duplicates. Its first run only
records the current source URLs, so enabling it never releases the historical backlog.

The default automation path writes a bodyless episode manifest, stores the exact RSS article
text as the local grounding source, and asks NotebookLM for a two-host Audio Overview. It no
longer sends a literal script to ElevenLabs. After upload, live preflight runs; a failure
restores the previous `feed.xml` automatically.

Railway runs `python3 automation/maintain.py` every twenty minutes (`*/20 * * * *`).
It refreshes and verifies NotebookLM authentication on every invocation. A private
volume at `/data` preserves the rotating cookie file and `podcast/health.json`.
`NOTEBOOKLM_AUTH_JSON` is a bootstrap secret: a changed value replaces the saved
login once, then child processes use the persisted file via `NOTEBOOKLM_HOME`.
Never upload this cookie file to the public podcast bucket.

Publication runs daily at nine in `America/Chicago`, with catch-up on the next
maintenance invocation if that time is missed. Articles posted after the daily check
are picked up the following day. A private daily ledger
and the existing R2 run history prevent repeat publication across maintenance runs.
A publication attempt is reserved before starting; after a failed/uncertain publication,
unresolved attempts block later days too. Inspect the live feed and reconcile the
private ledger before manually rerunning `node automation/weekly.mjs --force-schedule`.
Authentication failures before publication can recover on the next maintenance run.
Failed checks exit nonzero and retain a sanitized failure stage in `health.json`.
With `AUTOMATION_EMAIL_ALERTS=1`, the Composio CLI sends sanitized failure alerts
from the connected Air Sense Gmail account to `jason.jackson@locafy.com`, at most
once per failure stage per UTC day. `COMPOSIO_USER_DATA_JSON` supplies its private
CLI credentials from Railway secrets. An ambiguous email send is never retried
automatically. `last-publication.log` stays on the private volume for diagnosis.
These alerts require the container to start; they cannot detect a Railway outage.
Google can revoke sessions; if refresh fails, run `notebooklm login`, replace
the Railway bootstrap secret securely, and verify the next maintenance invocation.

---

## Audio providers

NotebookLM is the inherited provider for real shows and all new client configurations. The
others are explicit literal-TTS fallbacks.

| provider | for |
|---|---|
| **`notebooklm`** | **Default conversational podcast.** Creates a grounded Audio Overview from the matching ingested source. |
| `local` | Zero setup. [Piper](https://github.com/rhasspy/piper) via `PIPER_MODEL`, else macOS `say` via `SAY_VOICE` (`say -v "?"` lists them). |
| `command` | **Any local model with a CLI.** |
| `openai` | **Any OpenAI-compatible `/v1/audio/speech` server**, which is what most local TTS servers expose. |
| `elevenlabs` | Legacy literal hosted TTS for an explicitly approved script. |

### NotebookLM Audio Overviews

```json
"tts": {
  "provider": "notebooklm",
  "format": "deep-dive",
  "length": "default",
  "language": "en",
  "timeout": 1200,
  "retry": 2,
  "instructions": "Make this a lively conversation. Stay grounded in the source."
}
```

For each episode, podcast-kit matches `sourceArticle` to `sources/index.json`, uploads that
local text, generates the conversation, and downloads the exact returned artifact ID. Local
use reads the session created by `notebooklm login`; CI and Railway use the same storage-state
JSON through the secret `NOTEBOOKLM_AUTH_JSON`. Treat it as a bearer credential and never
commit or print it.

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

## Things this repo knows that cost someone a day

- **NotebookLM artifacts need exact IDs.** Downloading "latest" from a reused notebook can
  select the wrong episode after eventual-consistency delays. The task ID is carried into
  the download command.
- **Literal TTS drifts on long calls.** Those providers still synthesize per paragraph,
  level-match the chunks, and join them with a short beat.
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
generate.mjs tts/      NotebookLM/TTS → mix → output/feed.xml
publish.py   hosts/    upload + rebuild feed       (r2 · bunny · s3 · local)
preflight.mjs          validate the live feed, print the URL
```

MIT. Contributions welcome, particularly host and TTS adapters.
