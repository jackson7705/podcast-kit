# Feature: Weekly Air Sense Railway Podcast Publisher

## Feature Description

Add a bounded weekly automation that checks the Air Sense WordPress RSS feed, ignores the launch backlog, converts at most one genuinely new and suitable article into a grounded podcast script, renders it with ElevenLabs, publishes it to the existing R2-backed feed, and verifies the live feed.

## User Story

As the Air Sense podcast owner, I want new blog articles checked automatically each Monday so that suitable posts become podcast episodes without requiring me to remember the workflow.

## Problem Statement

The current ingest, gate, render, publish, and preflight stages are deterministic, but the source selection and writing step requires an interactive agent. That means RSS discovery alone does not publish new episodes.

## Solution Statement

Deploy a separate Railway cron service that runs at both possible UTC equivalents of Monday at 9:00 AM Central and enforces the local time inside the process. The runner baselines the current WordPress feed on first execution, compares future items against durable R2 state and the live podcast feed, selects no more than one suitable article, makes a tool-free structured OpenAI request, verifies exact source evidence for every generated passage, runs the existing gate, renders only the new slug, publishes only its audio plus the rebuilt feed, and rolls back the feed object if live preflight fails.

## Out of Scope / Non-Goals

- Not creating or managing podcast-directory accounts.
- Not republishing the historical WordPress backlog.
- Not publishing more than one new episode per weekly run.
- Not giving the model tools, shell access, web search, or direct access to service credentials.
- Not changing existing episode slugs, GUIDs, audio, or publication dates.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: RSS ingestion, script generation, quality gates, ElevenLabs rendering, R2 publishing, Railway scheduling
**Dependencies**: Node.js 22, Python 3, ffmpeg/ffprobe, boto3, OpenAI Responses API, ElevenLabs, Cloudflare R2

## Architecture Decision

The original repository contract keeps model calls outside deterministic scripts. Fully unattended publishing explicitly changes that operating mode. The automation therefore uses one narrowly scoped structured-output request instead of an unrestricted coding agent. The source article is treated as untrusted data, the model receives no tools, and every generated spoken block must include an exact supporting excerpt that is checked locally before rendering.

## Context References

- `AGENTS.md` - Script format, grounding, pacing, voice, and gate contract.
- `ingest.mjs`, `ingest/html.mjs`, `ingest/rss.mjs` - Existing discovery and HTML-to-text behavior.
- `generate.mjs` - Single-slug rendering and feed generation.
- `publish.py`, `hosts/r2.py` - Upload ordering and R2 backend.
- `preflight.mjs` - Live-feed release gate.
- `gates/check.py`, `gates/patterns.json` - Deterministic script quality checks.
- `show.config.json`, `pronunciations.json` - Air Sense show brief and TTS pronunciation rules.
- [OpenAI Responses quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request) - Server-side Responses API pattern.
- [OpenAI structured outputs](https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal/delta) - Strict JSON Schema output.
- [Railway cron jobs](https://docs.railway.com/cron-jobs) - UTC cron execution and run-to-completion behavior.

## New Files to Create

- `automation/weekly.mjs` - Orchestrator, parser, source selection, structured writing request, evidence checks, hydration, render/publish/preflight flow.
- `automation/r2_state.py` - Minimal durable state and feed-backup operations using the existing R2 credentials.
- `automation/show.config.json` - Non-secret Air Sense runtime config included in the deployment image.
- `automation/test/weekly.test.mjs` - Deterministic unit tests for parsing, selection, scheduling, and evidence validation.
- `Dockerfile.automation` - Railway cron runtime with Node, Python, ffmpeg, and boto3.
- `.claude/reports/weekly-railway-publisher-report.md` - Implementation and validation report.

## Files to Update

- `publish.py` - Read process environment variables and support `--slug` so automation uploads only the new episode audio.
- `.gitignore` - Ignore automation runtime state and backup artifacts.
- `README.md` - Document the opt-in weekly automation and its safety boundary.

## Implementation Plan

### Phase 1: Deterministic foundations

- Add RSS/podcast-feed parsing, Central-time schedule guard, canonical URL handling, source suitability rules, and exact-evidence validation.
- Add R2 state get/put and feed backup/restore commands.
- Add live-feed hydration so every previously published episode remains in rebuilt feeds even when the cron container starts from a clean image.

### Phase 2: Bounded writing and publishing

- Build a strict structured-output request with no tools and an untrusted-source boundary.
- Build MDX from validated output using the next live episode number and a publication timestamp in the past.
- Run `gates/check.py` on only the new script, render only the new slug, upload only the new audio, rebuild/upload the feed, and run live preflight.
- Restore the prior feed if preflight fails; write durable state only after a successful release or deterministic skip.

### Phase 3: Tests and runtime image

- Test parser behavior, daylight-saving schedule behavior, first-run baseline, one-item selection, pricing/short-source rejection, and evidence mismatch rejection.
- Add the Railway Docker image and non-secret show config.

### Phase 4: Deployment

- Create a new Railway project and service without changing the linked Hermes project.
- Store OpenAI, ElevenLabs, and R2 credentials as Railway variables.
- Configure `0 14,15 * * 1`; the in-process `America/Chicago` guard permits only the occurrence that is locally Monday at 9:00 AM.
- Run one forced initialization to baseline the existing WordPress feed without publishing.
- Verify service configuration, initialization logs, and next scheduled execution.

## Validation Commands

```text
node --test automation/test/*.test.mjs
python3 -m py_compile automation/r2_state.py publish.py
python3 gates/check.py
node generate.mjs --dry-run
node setup-check.mjs
cd worker && npm test
scripts/check-secrets.sh
node automation/weekly.mjs --dry-run --force-schedule
docker build -f Dockerfile.automation .
```

## Rollback

- Disable or remove the Railway cron schedule to stop future runs.
- If a publication fails preflight, the runner restores the feed object captured immediately before publishing.
- Orphaned audio from a failed attempt is harmless because no feed item references it.

## Amendment: NotebookLM migration (2026-08-23)

The production audio architecture was superseded by
`.claude/plans/migrate-railway-to-notebooklm.md`. Air Sense now writes a bodyless manifest
and stores the RSS article text as the local grounding source for NotebookLM. The structured
OpenAI script plus ElevenLabs path remains only as code-level backward compatibility for a
future client that explicitly selects a literal provider; it is no longer the Air Sense or
repository default.
