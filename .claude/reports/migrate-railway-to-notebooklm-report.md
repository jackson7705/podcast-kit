# Implementation Report — Air Sense Railway to NotebookLM

**Plan**: `.claude/plans/migrate-railway-to-notebooklm.md`
**Branch**: `feature/airsense-podcast-launch`
**Status**: COMPLETE

## Summary

NotebookLM is now the inherited podcast-kit provider and the explicit Air Sense production
provider. The weekly publisher converts a selected RSS item into a bodyless episode manifest,
saves the exact article text as its local grounding source, and delegates the conversation to
NotebookLM instead of sending a literal script to ElevenLabs.

Railway deployment `1d98d883-1209-4256-bc7d-33d791530d49` succeeded with the requested fork
pinned at commit `3bb0c1850ac4e85378a831581a0cf1e82fa80272`. Production has
`TTS_PROVIDER=notebooklm`, a validated `NOTEBOOKLM_AUTH_JSON` secret, and no ElevenLabs API
key or voice ID. The existing Monday cron schedule is unchanged.

## Tasks completed

- CREATE `tts/notebooklm.mjs` — source-grounded create/generate/poll/download adapter.
- CREATE `test/notebooklm.test.mjs` — deterministic adapter coverage.
- UPDATE `generate.mjs` and `tts/index.mjs` — whole-episode provider dispatch and mixing.
- UPDATE `lib/config.mjs` and `show.config.example.json` — NotebookLM inherited defaults.
- UPDATE `automation/weekly.mjs` — RSS article source persistence and bodyless manifests.
- UPDATE `automation/show.config.json` — explicit Air Sense NotebookLM direction.
- UPDATE `Dockerfile.automation` — pinned fork installation and version build check.
- UPDATE setup and operator documentation for local and Railway authentication.
- CONFIGURE Railway production auth/provider and remove obsolete ElevenLabs secrets.

## Tests added

- Seven NotebookLM provider tests covering local-source preference, URL fallback, exact
  artifact selection, state reuse, source-change invalidation, malformed JSON, and prompt
  composition.
- One weekly automation test covering stable URL-derived slugs, source-derived descriptions,
  required grounding metadata, and a bodyless manifest.

## Validation results

- JavaScript syntax checks: PASS.
- Node tests: PASS, 14/14.
- Python compilation: PASS.
- Existing literal demo gate: PASS, 1/1.
- Air Sense NotebookLM dry run: PASS, 3/3 manifests ready.
- Setup check: PASS, authenticated NotebookLM and R2 publisher ready.
- Secret scan: PASS.
- `git diff --check`: PASS.
- Railway production-variable passive auth check: PASS.
- Railway container build: PASS, NotebookLM CLI 0.8.1.
- Railway deployment: SUCCESS, `1d98d883-1209-4256-bc7d-33d791530d49`.
- Post-deploy Railway-variable dry run: PASS, no suitable new article and no writes.

## Deviations from the plan

Railway cron deployments are build-only until their next scheduled invocation, so the safe
post-deploy smoke used `railway run` with the exact production variable set. The container
build separately proved the pinned CLI was installed. No cron was forced and no episode was
published.

## Issues encountered

The first direct Railway upload failed before creating a deployment because the CLI could
not package the Git worktree (`prefix not found`). A clean, secret-free temporary staging
bundle avoided the worktree metadata and deployed successfully.
