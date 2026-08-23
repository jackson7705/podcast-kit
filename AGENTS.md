# Creating episodes

This file is the contract for turning source articles into episode manifests or literal
scripts. Claude Code and Codex both read it automatically. Read `show.config.json` first,
because `tts.provider` selects one of two materially different jobs.

- With `tts.provider: "notebooklm"` (the real-show default), you choose the source and write
  an episode manifest: frontmatter plus optional `audioInstructions`. NotebookLM generates
  and performs the conversation from the matching ingested source. Do not write a spoken
  body that nobody will use.
- With any other provider, you are the writing step. Read source text and write the complete
  spoken script in the MDX body. The provider reads it literally.

---

## The loop

```text
sources/NN.txt  →  you choose + write metadata  →  episodes/NN-slug.mdx
                                                      ↓
                        notebooklm provider: conversational Audio Overview
                        literal provider: gate → script TTS
```

For literal providers, **`gates/check.py` is a failing test, and you iterate against it until
it passes.** Do not render anything it flags. If you think a flag is wrong for this show, edit
`gates/patterns.json` and say so — do not work around it by rephrasing until the regex
stops matching. Relexicalising to beat a check is the failure mode this loop exists to
prevent.

---

## The file format

One episode is one `.mdx` file in `episodes/`. Frontmatter is machine-read and drives the
RSS feed. Under NotebookLM, the body is empty. Under literal providers, the body is the
spoken script and nothing else: no headings, lists, markdown formatting, or stage directions.

```mdx
---
episodeNumber: 2
title: "The RFP That Gets You Good Bids"
slug: "the-rfp"
publishedAt: "2026-08-21T01:01:00Z"
description: "Most video RFPs are missing the one thing that would get you comparable quotes."
sourceArticle: "https://example.com/how-to-write-a-video-rfp/"
topicUrl: "https://example.com/podcast/the-rfp/"
audioInstructions: "Focus on why comparable bids require a shared production brief."
---

<NotebookLM: leave empty>

<literal provider: the hook, then <!--hook-->, then the body>
```

| field | rule |
|---|---|
| `episodeNumber` | Integer, unique, sets feed order. |
| `slug` | Kebab-case. Becomes the audio path and the guid. **Never reuse or change one after publishing** — the guid is how directories tell episodes apart. |
| `publishedAt` | ISO 8601, **in the past**. A future date means Apple and Spotify silently hide the episode. Staggering a season into the future is the most common launch mistake there is. |
| `description` | One or two sentences. Shown in every podcast app. |
| `sourceArticle` | The post this episode is drawn from. **This is a grounding contract, not a citation** — see below. |
| `topicUrl` | Optional. When set, the feed item links here instead of the show root. |
| `audioInstructions` | Optional NotebookLM direction for this episode. One line, about angle or audience, not invented facts. |
| `duration` | **Do not write this.** `generate.mjs` measures the render and writes it back. |

---

## Literal providers: three things about the body that are load-bearing

**1. `<!--hook-->` splits the cold open from the body.** They are synthesised separately so
the intro music can overlap and duck under the host's first line. The hook has to work as
a standing start: no "welcome back", no throat-clearing, no naming the show.

**2. Paragraph breaks are pacing, not formatting.** Each `\n\n` becomes its own TTS call,
level-matched and joined with a beat. So a paragraph break is where the speaker breathes.
Long paragraphs suffocate a voice even when they read fine on a page — the gate flags
anything over 90 words. Vary paragraph length deliberately; uniform blocks sound like a
machine reading a document, which is what they are.

**3. It must survive being read aloud.** Specifically:

- **No em-dashes.** The voice does not pause on them. The gate fails on any.
- **Numbers as words** where the reading matters. "Twenty-seven hundred dollars", not "$2,700".
- **Short sentences.** Whatever survives the page can still strand a human voice.
- **Any domain or acronym needs a `pronunciations.json` entry**, or TTS fuses it into one
  word. Write the real thing in the script; the map fixes it at synthesis time.

---

## Grounding

**Every fact in an episode traces to its `sourceArticle`.** Not "is consistent with": it
traces. If the article does not contain it, it does not go in a script or NotebookLM prompt.
The NotebookLM adapter prefers the matching local file from `sources/index.json`, falling
back to the URL only when the local mapping is unavailable.

This matters more in audio than on a page. A page can hedge; a spoken sentence commits. And
you cannot quietly correct a podcast episode after directories have cached it.

- **No invented prices, dates, statistics, credentials or claims.** If you want a number the
  source does not have, ask for it. Do not estimate.
- **A practitioner's opinion is their experience, not a cited fact.** Frame it that way.
- **Check what the source itself gets wrong.** Articles carry errors. If you are about to
  repeat a figure that looks wrong, flag it rather than laundering it into audio.

---

## Format

For literal providers, `episode.targetWords`, `episode.cta`, and the show's `description`
set the writing brief. Then:

**Answer-first.** Open on the question and answer it inside the first fifteen seconds. Then
why it is true, then what to do about it. Never open with context, a trend, or a preamble.
A listener decides in eight seconds.

**One episode, one question.** If it needs two, it is two episodes.

**The close comes last, after the final substantive line, never mid-episode.** Use the
`cta` string from config verbatim unless told otherwise. Name who you are, where you
operate, one reason to go, then the destination. No urgency, no offer nobody cleared.

For NotebookLM, express the one question in `description` and any extra angle in
`audioInstructions`. The adapter passes the configured CTA as an exact closing-line request.
Do not try to pre-script host dialogue in either field.

---

## Voice

If the repo has a `voice.md`, read it and follow it. For NotebookLM, turn only the most
important register guidance into concise `tts.instructions` or `audioInstructions`; for a
literal provider it governs the whole script.

Absent that, the thing to avoid is the register of anonymous internet advice. Two symptoms
worth watching, both of which the gate measures:

- **Pronoun ratio.** A show where a company talks about its own work runs high on *we*. A
  craft or how-to show runs lower. What is always wrong is near-zero *we* against heavy
  *you* — that is an advice column with no author, and it is what content written to rank
  sounds like.
- **Specificity.** The reason to keep concrete details is not colour, it is that removing
  them is what makes writing go generic. When you have to anonymise something, keep the
  fact and drop the name: "a mentoring organisation", "on one shoot".

---

## Choosing which posts become episodes

You will usually have more sources than episodes. Pick on:

1. **Does the source have enough substance?** Under about 800 words rarely yields three
   minutes without padding, and padding is audible.
2. **Is it a question someone asks out loud?** Audio suits questions, not reference material.
3. **Does it commit you to something you cannot say in audio?** Pricing is the usual one.
   A page can frame a number; a spoken rate gets quoted back to you.

Write the list before creating manifests or scripts, and say which source each episode maps to.
