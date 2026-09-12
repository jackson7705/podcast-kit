# Daily podcast check implementation

Plan: `.claude/plans/daily-podcast-check.md`
Branch: `feature/airsense-podcast-launch`
Status: COMPLETE

Changed maintenance to one check per America/Chicago date at or after 9 AM,
including weekends. Updated standalone publisher guard and README. Preserved URL
watermark, baseline handling, authentication refresh and publication reservation.
Unresolved daily or legacy weekly attempts block further automatic publication.
The user explicitly confirmed 9 AM Central. Later articles wait until next day.

Validation: 12 Python and 22 Node tests passed; secret scan and diff check passed.
Tests cover daily rollover, prior-day history, DST, weekends, catch-up, duplicates,
and unresolved legacy attempts.

Deployed Railway service 5f705e2b-f188-4f24-8bb8-47de1987a93d in project
 aae4d4d5-8044-46ae-b42a-80d2e62ca2f0, production.
Deployment 333aa048-cf98-4d25-a09b-d82e38433ccf reports SUCCESS.
Readback confirms cron */20 * * * * and start python3 automation/maintain.py.
Runtime logs were empty at verification; SSH access to the volume was denied.
First scheduled runtime completion is therefore not yet verified.

Deviation: Composio Railway connection unavailable; used the existing authenticated
native Railway CLI as in previous deployments. No credentials changed. Existing
uncommitted authentication changes were preserved and included in the deployment.
