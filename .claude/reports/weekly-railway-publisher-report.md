# Implementation Report — Weekly Air Sense Railway Podcast Publisher

**Plan**: `.claude/plans/weekly-railway-publisher.md`
**Branch**: `feature/airsense-podcast-launch`
**Status**: COMPLETE

## Summary

Implemented and deployed a separate Railway cron service that checks the Air Sense WordPress feed every Monday at nine Central, handles daylight saving time, suppresses the launch backlog, and can publish at most one suitable new article per week. The model receives no tools and must return strict structured output with exact source evidence for every generated passage before the existing voice gate, ElevenLabs render, R2 upload, and live preflight can run.

The Railway project is `airsense-podcast-automation`, service `weekly-publisher`. Durable R2 state was initialized with ten current source URLs, so no historical article will be published by the automation.

## Tasks completed

- CREATE `automation/weekly.mjs` - RSS detection, Central-time guard, suitability filtering, one-item queue, structured writing request, evidence validation, live-feed hydration, bounded render/publish/preflight, and rollback.
- CREATE `automation/r2_state.py` - Durable state and feed backup/restore operations against the existing R2 bucket.
- CREATE `automation/show.config.json` - Non-secret Air Sense runtime configuration for the deployment image.
- CREATE `automation/test/weekly.test.mjs` - Parser, schedule, selection, and grounding tests.
- CREATE `Dockerfile.automation` - Node, Python, ffmpeg, and boto3 Railway runtime.
- UPDATE `publish.py` - Process-environment credentials and single-slug uploads.
- UPDATE `.gitignore` - Automation runtime artifacts.
- UPDATE `README.md` - Opt-in automation behavior and security boundary.
- DEPLOY Railway project `airsense-podcast-automation`, service `weekly-publisher`.
- CONFIGURE Railway cron `0 14,15 * * 1` with an `America/Chicago` in-process guard.
- INITIALIZE R2 watermark with ten current blog URLs.

## Tests added

- Canonical URL normalization.
- WordPress full-content RSS parsing.
- Podcast feed metadata and audio-slug parsing.
- Central daylight-saving and standard-time schedule behavior.
- Seen, thin, and pricing-source filtering with one-item selection.
- Exact-source evidence acceptance and mismatch rejection.

## Validation results

- `node --test automation/test/*.test.mjs` - PASS, 6/6.
- `python3 -m py_compile automation/r2_state.py publish.py` - PASS.
- `python3 gates/check.py` - PASS, 3/3 episodes clean.
- `node generate.mjs --dry-run` - PASS, 3/3 scripts ready.
- `node setup-check.mjs` - PASS, ready.
- `npm test --prefix worker` - PASS, 7/7.
- `scripts/check-secrets.sh` - PASS, clean.
- `git diff --check` - PASS.
- OpenAI `gpt-5.6-terra` strict structured-output smoke test - PASS.
- Live source dry run - PASS, detected ten-URL baseline without writes.
- Railway image build - PASS.
- Railway state initialization - PASS, ten URLs recorded.
- Post-initialization dry run - PASS, no new article detected.
- Live podcast preflight - PASS, three episodes and three enclosures reachable.

## Deviations from the plan

- Local Docker validation could not run because Docker is not installed on the Mac. Railway built the same Dockerfile successfully, which served as the container build validation.
- The first Railway build failed before deployment because the temporary upload bundle excluded `automation/show.config.json`. The bundle was corrected and the next build succeeded. No service executed and no external state changed during the failed build.

## Issues encountered

- The Composio Railway connector remains unlinked in the active Locafy Composio workspace. Deployment used the already authenticated native Railway CLI under `jason@growthproagency.com`.
- The original repository contract had no automated model call. This implementation documents the approved unattended mode as an explicit, narrowly scoped exception with no model tools and deterministic evidence checks.

## Superseded audio path (2026-08-23)

The Air Sense production service has since migrated from structured OpenAI scripts plus
ElevenLabs narration to source-grounded NotebookLM Audio Overviews. See
`.claude/reports/migrate-railway-to-notebooklm-report.md`. The scheduling, R2 state,
single-item selection, live preflight, and rollback controls described above remain active.
