# Feature: Make NotebookLM the repository and Air Sense Railway default

## Feature Description

Move the existing Air Sense weekly Railway publisher from literal ElevenLabs narration to
source-grounded NotebookLM Audio Overviews, and make NotebookLM the inherited provider for
all newly configured podcast-kit clients. Preserve literal providers only as explicit legacy
choices.

## User Story

As the podcast-kit operator, I want Air Sense and every new client to use NotebookLM by
default so episodes sound like produced conversations instead of articles read aloud.

## Problem Statement

The NotebookLM feature branch changes the generic provider default, but the separately built
Air Sense Railway cron still ships an explicit ElevenLabs config and writes a literal script
through an OpenAI-plus-TTS path. Its container also lacks the NotebookLM CLI and authenticated
session. A config-only change would therefore fail in Railway and would not change the weekly
authoring path.

## Solution Statement

Integrate the whole-episode NotebookLM provider into the Air Sense branch, switch the generic
defaults and Air Sense runtime config, and teach the weekly runner to create an episode
manifest plus a local RSS-derived grounding source instead of a literal script. Install the
pinned `jackson7705/notebooklm-py` fork in the Railway image. Store the already authenticated
Playwright storage state only as Railway's `NOTEBOOKLM_AUTH_JSON` secret, force
`TTS_PROVIDER=notebooklm`, remove the obsolete ElevenLabs secrets, deploy, and run a
non-publishing Railway smoke check.

## Out of Scope / Non-Goals

- Do not publish the private test episode or trigger a scheduled Air Sense release.
- Do not remove explicit legacy `elevenlabs`, `local`, `command`, or `openai` adapters.
- Do not change existing live episode GUIDs, audio files, or feed entries.
- Do not commit or print Google, ElevenLabs, OpenAI, or R2 credentials.

## Feature Metadata

**Feature Type**: Enhancement and production migration
**Estimated Complexity**: High
**Primary Systems Affected**: provider dispatch, whole-episode generation, weekly automation,
Railway image and secrets
**Dependencies**: Node 22, Python 3, ffmpeg, pinned `notebooklm-py` fork, NotebookLM session,
Railway cron, R2

## Context References

- `tts/notebooklm.mjs` on branch `Notbook-LM` - tested whole-episode CLI adapter.
- `generate.mjs` - provider capability dispatch and final MP3/feed contract.
- `lib/config.mjs`, `show.config.example.json` - inherited client defaults.
- `automation/weekly.mjs` - Air Sense RSS selection, durable state, render/publish sequence.
- `automation/show.config.json` - explicit production provider configuration.
- `Dockerfile.automation` - Railway runtime image.
- `automation/test/weekly.test.mjs`, `test/notebooklm.test.mjs` - deterministic coverage.
- `notebooklm-py` installed package guidance - `NOTEBOOKLM_AUTH_JSON` is the documented CI/CD
  auth path and must be treated as a bearer credential.

## Implementation Plan

### Phase 1: Merge provider capability

- Add the tested NotebookLM adapter and provider registration.
- Refactor `generate.mjs` to dispatch whole-episode generation while retaining the existing
  Air Sense feed-owner email behavior and literal path.
- Make NotebookLM the code and sample-config default.

### Phase 2: Convert weekly automation

- When NotebookLM is selected, derive stable metadata from the RSS item, save the exact item
  text to `sources/`, update `sources/index.json`, and write a bodyless MDX manifest.
- Keep the legacy structured script function available only for explicitly selected literal
  providers.
- Skip the literal voice gate for NotebookLM manifests; keep selection, hydration, R2 upload,
  live preflight, rollback, and durable state unchanged.

### Phase 3: Railway runtime and credentials

- Install the pinned fork in `Dockerfile.automation` without browser dependencies.
- Use `NOTEBOOKLM_AUTH_JSON` from Railway secrets and set `TTS_PROVIDER=notebooklm`.
- Delete Air Sense's obsolete ElevenLabs variables only after the NotebookLM secret validates.
- Deploy the Air Sense `weekly-publisher` service without forcing the publication schedule.

### Phase 4: Validation

- Run syntax checks, generic NotebookLM tests, weekly automation tests, Python compilation,
  demo literal gate, setup checks, security scan, and diff checks.
- Run `notebooklm auth check --test --passive` under the exact Railway variable surface.
- Run the Railway image with `--dry-run --force-schedule`; it may inspect sources but must not
  create audio, upload, publish, or write durable state.

## Step-by-Step Tasks

1. **CREATE** `tts/notebooklm.mjs` and `test/notebooklm.test.mjs` from the validated feature branch.
2. **UPDATE** `tts/index.mjs`, `generate.mjs`, `lib/config.mjs`, `setup-check.mjs`,
   `show.config.example.json`, `.env.example`, `AGENTS.md`, and `README.md` while preserving
   Air Sense's deployment-specific fixes and documentation.
3. **UPDATE** `automation/show.config.json` to an explicit NotebookLM deep-dive configuration.
4. **UPDATE** `automation/weekly.mjs` and its tests for manifest/source creation.
5. **UPDATE** `Dockerfile.automation` to install fork commit
   `3bb0c1850ac4e85378a831581a0cf1e82fa80272`.
6. **VALIDATE** locally with the commands below.
7. **CONFIGURE** Railway's NotebookLM secret and provider override without printing secrets.
8. **DEPLOY** and verify the new image and a non-publishing smoke run.

## Validation Commands

```text
node --check generate.mjs
node --check setup-check.mjs
node --check tts/index.mjs
node --check tts/notebooklm.mjs
node --check automation/weekly.mjs
node --test test/*.test.mjs automation/test/*.test.mjs
python3 -m py_compile gates/check.py publish.py hosts/*.py automation/r2_state.py
python3 gates/check.py demo/episodes/01-what-this-is.mdx
node setup-check.mjs
bash scripts/check-secrets.sh
git diff --check
```

## Acceptance Criteria

- Air Sense `automation/show.config.json` and Railway `TTS_PROVIDER` both select NotebookLM.
- Railway has usable `NOTEBOOKLM_AUTH_JSON`; its value is never printed or committed.
- The Railway image contains the requested pinned fork and passes passive auth validation.
- New clients inherit NotebookLM even if their `tts.provider` field is omitted.
- Weekly Air Sense episodes use RSS-derived local text as NotebookLM grounding and do not call
  ElevenLabs or require a literal script.
- Existing literal providers remain available only through explicit configuration.
- The deployed smoke run cannot publish and all validation commands pass.

## Rollback

Redeploy the prior successful Railway image or explicitly set the Air Sense config/provider
back to `elevenlabs`. Existing feed and audio objects remain unchanged because migration smoke
tests do not publish.
