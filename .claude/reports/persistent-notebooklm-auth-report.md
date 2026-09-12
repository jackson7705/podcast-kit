# Implementation Report — Persistent NotebookLM authentication

**Plan**: `.claude/plans/persistent-notebooklm-auth.md`
**Branch**: `feature/airsense-podcast-launch`
**Status**: COMPLETE

## Outcome
Refreshed the Google login and Railway bootstrap credential. Published episode 5,
Basement Radon Mitigation Systems (5:37), on September 10. Live preflight passed:
five episodes, all audio enclosures reachable, no future dates.

## Reliability changes
- `automation/maintain.py`: verified twenty-minute cookie refresh, private volume
  storage, revisioned bootstrap, exclusive lock, Central-time weekly deduplication,
  R2 publication-history reconciliation, sanitized failure ledger, process-group
  timeout handling, and private publication diagnostics.
- `automation/alert.py`: Composio CLI Gmail alerts to jason.jackson@locafy.com,
  from the existing Air Sense account. Reserve stage/day before sending so uncertain
  sends are not automatically retried.
- `Dockerfile.automation`, `.dockerignore`, `README.md`: runtime and operator contract.
- `automation/test/test_maintain.py`: nine tests for cookie preservation/rebootstrap,
  schedule/DST, manual and scheduled deduplication, auth failure, corrupt state,
  failed publication and uncertain/alternating alert deduplication.

## Validation
- Nine Python tests and 21 existing Node tests pass.
- Python syntax checks and secret scan pass.
- Live Railway-variable refresh smoke passes.
- First deployed container refreshed successfully at 2026-09-10T11:58:47Z.
- Final deployment `0ef17c45-bc3c-4b29-8b3a-4449024b3564` succeeded and
  refreshed successfully from the same private volume at 2026-09-10T12:01:22Z.
- Gmail accepted the authorized delivery test; sent-message metadata confirms the
  exact destination and subject. Message ID: 1a08b2ccef48d888.
- Railway private volume: 9171610c-463d-416d-b493-054f7838ea4b, mounted at /data.
- Cron: `*/20 * * * *`; start: `python3 automation/maintain.py`.

## Deviations and limits
Railway native notification rules cannot target the requested non-member email.
Used the existing connected Composio Gmail CLI instead; its bootstrap is a Railway
secret, excluded from image/source/logs. Alerts require the container and email
connection to work, so they do not independently detect Railway outages or missed
cron invocations. Google can revoke sessions despite keepalive and require login.
No master-token enrollment or browser automation is used for scheduled refresh.
Publication failures are not automatically retried; inspect the feed first, manually
rerun, then reconcile the private weekly ledger if needed.
