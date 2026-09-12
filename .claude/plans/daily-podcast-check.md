# Daily podcast check

Replace the Monday-only publication gate with a daily Central-time gate. Preserve
NotebookLM authentication maintenance, URL deduplication, baseline suppression,
private attempt reservation and R2 history reconciliation. Keep the existing
weekly.mjs filename for operational compatibility.

## Tasks
1. Change maintenance ledger and history comparisons from ISO week to local date.
   Honor unresolved legacy weekly attempts so migration cannot retry uncertain writes.
2. Change the standalone JavaScript schedule guard and documentation to daily.
3. Test weekdays, weekends, DST, same-day deduplication, next-day eligibility,
   prior-day R2 history and legacy uncertain attempts.
4. Deploy to the existing Air Sense Railway service and verify schedule and logs.

## Validation
- python3 -m unittest discover -s automation/test -p 'test_*.py'
- node --test automation/test/*.test.mjs test/*.test.mjs worker/test/*.test.mjs
- bash scripts/check-secrets.sh
- git diff --check

## Assumptions
User confirmed 9 AM Central. Use the first maintenance invocation at or after nine. A once-daily check picks up
articles published after its run on the following day. Deployment includes the
existing uncommitted authentication maintenance implementation already live.
