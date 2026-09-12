# September catch-up publication

User authorized publishing the September 8 and September 10 articles.

- Episode 6: Does Crawl Space Encapsulation Add Value to Your Home?
- Episode 7: Is Radon Mitigation Necessary?

The user completed NotebookLM login after local and Railway authentication expired.
Passive checks now pass locally and with the updated Railway bootstrap secret.

The first renders failed transcript review: episode 6 invented a $30,000 example
and episode 7 invented a cigarette-risk comparison. Neither was published.
Replacement renders use selected verbatim article excerpts and stricter episode
instructions. The radon excerpts omit overbroad below-two safety/value assurances,
local prevalence statistics, legal claims, and waiting-time assurances.

Episode 7 passed replacement transcript review. Episode 6 needed a third render,
using NotebookLM brief format and a narrower set of source excerpts. Its final
transcript passed review. Duration measured from rendered audio: 6 = 1:40; 7 = 2:54.
No intro/outro music assets exist, so the final brief voice track is the episode MP3,
matching the generator's no-music path. Duration was measured with lib/audio.mjs.

Both audio files and the rebuilt feed are published. Live preflight passes with
seven episodes, all seven enclosures reachable, and no future dates. R2 publication
history and seen URLs were updated and read back for episodes 6 and 7.

Railway redeployment 4a60b50e-4b3f-4954-9f34-aa9b85e93cc9 activates the refreshed
bootstrap credential and reports SUCCESS. Runtime logs were empty at readback;
the next scheduled container authentication check is not yet verified. The exact
Railway variable surface passed a passive NotebookLM token check before redeploy.

## Project handoff — paused for usage efficiency

Status: PENDING resume. User requested an immediate end to model-driven sleep/status
polling. No remote actions were taken for this handoff. Read the newly added global
usage-efficiency instructions on the next resume before doing any work.

Actual last-known state: both final NotebookLM jobs completed and episodes 6 and 7
were already published before the pause request. No generation is known to remain
pending. Do not regenerate or republish them. Pending verification is only the next
scheduled Railway authentication check; deployment itself reported SUCCESS.

Preserved final NotebookLM job/artifact IDs:
- Episode 6 notebook: `4d2ea236-56f2-4d57-97ab-c7ba1f9ef255`
  Job/artifact: `90cb9b32-609d-4701-abaf-3cdc968ab64c`
  State: `output/does-crawl-space-encapsulation-add-value/notebooklm.json`
- Episode 7 notebook: `9f528103-6b88-4165-8559-83b372157c1f`
  Job/artifact: `622b103e-0130-4149-9cbe-1882c1a6af2a`
  State: `output/is-radon-mitigation-necessary/notebooklm.json`

Exact resume steps:
1. Read current global and project instructions, especially usage efficiency.
2. Read this handoff and the two local state files. Do not invoke generate.mjs,
   `notebooklm generate`, or publish.py: the final artifacts are already published.
3. If runtime verification is still requested, make one bounded read of Railway:
   `railway logs 4a60b50e-4b3f-4954-9f34-aa9b85e93cc9 --deployment --lines 20 -p aae4d4d5-8044-46ae-b42a-80d2e62ca2f0 -s 5f705e2b-f188-4f24-8bb8-47de1987a93d -e production`
   Inspect for a successful maintenance/authentication result. If absent, leave
   verification pending rather than repeatedly polling from model turns.
4. Only if an artifact's status needs reconfirming, use one read-only command:
   `notebooklm artifact poll 90cb9b32-609d-4701-abaf-3cdc968ab64c -n 4d2ea236-56f2-4d57-97ab-c7ba1f9ef255 --json`
   `notebooklm artifact poll 622b103e-0130-4149-9cbe-1882c1a6af2a -n 9f528103-6b88-4165-8559-83b372157c1f --json`
5. For future genuinely pending jobs, use a bounded deterministic CLI/script wait
   with a fixed deadline and saved result, not repeated model sleep/status calls.
   Resume once at completion or deadline. Never cancel, restart, or regenerate a
   job merely because waiting ended. Preserve its ID and report pending status.

No further publication, generation, cancellation, restart, or polling is authorized
by the usage-efficiency request itself.

## September 12 Railway crash investigation

User reported the Railway crash notification. Latest failed invocation
`a46b80da-43ef-45d4-ac61-4b3fb2705b41` failed at authentication at
2026-09-12T16:22:36Z. A passive check using Railway variables failed token_fetch;
the local NotebookLM session passed. Replaced NOTEBOOKLM_AUTH_JSON securely via
stdin with the working local storage state. Production-variable passive check
then passed. Resulting deployment `73f9ec00-d475-4a5c-b093-9301fcbc952d` reports
SUCCESS. Its bounded runtime log read was empty: container refresh and scheduled
publication remain unverified. No code changed or episodes manually republished.
Resume with one bounded runtime log read:
`railway logs 73f9ec00-d475-4a5c-b093-9301fcbc952d --deployment --lines 20 -p aae4d4d5-8044-46ae-b42a-80d2e62ca2f0 -s 5f705e2b-f188-4f24-8bb8-47de1987a93d -e production`
