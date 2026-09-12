# Feature: Persistent NotebookLM authentication and visible failures

## Problem and approach
The September 7 publisher failed on stale Google cookies. The image reloads an
immutable NOTEBOOKLM_AUTH_JSON and runs only weekly. Use the pinned CLI's verified
HTTP refresh every twenty minutes, storing its rotating cookie file on a private
Railway volume. Keep the bootstrap secret as a revisioned recovery input, never as
the active child-process auth source. Google revocation still needs human login.

## Context and inherited decisions
- `Dockerfile.automation`: pinned notebooklm-py 3bb0c185.
- `automation/weekly.mjs:435`: existing weekly source selection and publication.
- `automation/r2_state.py`: public podcast bucket; NEVER store credentials here.
- `.claude/plans/migrate-railway-to-notebooklm.md`: bodyless grounded episodes.
- Pinned docs: https://github.com/jackson7705/notebooklm-py/blob/3bb0c1850ac4e85378a831581a0cf1e82fa80272/docs/troubleshooting.md#cookie-freshness-for-long-running--unattended-use

## Tasks, in order
1. CREATE `automation/maintain.py`: private file bootstrap, exclusive lock, verified
   refresh, bounded health ledger; launch weekly Node runner only once per Central
   calendar week. Save an attempt before publishing; do not automatically repeat
   uncertain publication failures. Auth failures before publication remain retryable.
2. ADD meaningful Python tests for bootstrap revision, rotated-cookie preservation,
   failed refresh, weekly deduplication, and publication failure persistence.
3. UPDATE Docker entry point and README. Keep existing Node runner usable for manual
   recovery and dry-run. Configure Railway volume, twenty-minute cron, and native
   project failure email rule to jason.jackson@locafy.com.
4. Validate Python tests, existing Node automation/provider/Worker tests, secret scan,
   and deploy. Verify a live refresh in the container and notification rule readback.

## Acceptance criteria
- Refreshed auth survives container runs; secret values never enter logs/public R2.
- Every scheduled invocation verifies auth; failure yields nonzero and durable status.
- At most one scheduled publication attempt per week, even with three runs at 9 AM.
- Failures trigger native Railway email alerts, including container startup failure.
- Current manually published week is seeded in the private ledger to avoid duplicates.

## Validation
`python3 -m unittest discover -s automation/test -p 'test_*.py'`
`node --test automation/test/*.test.mjs test/*.test.mjs worker/test/*.test.mjs`
`python3 -m py_compile automation/maintain.py`
`bash scripts/check-secrets.sh`

## Scope
No automatic browser login, master-token enrollment, or podcast content changes.

## Amendments
- 2026-09-10: Railway native notification schema only targets workspace users,
  webhooks or roles; requested Locafy email is not a member. Use the existing
  Composio CLI Gmail connection for sanitized, deduplicated failure emails instead.
  CLI bootstrap stays in Railway secrets. This cannot detect container startup or
  Railway outages; document that limit. Send one authorized delivery test.
