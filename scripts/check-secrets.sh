#!/usr/bin/env bash
# Refuse to publish credentials. Run before any push.
#
# Two things it looks for:
#
#   1. Credential shapes — always. .gitignore keeps .env and show.config.json out, but people
#      un-ignore show.config.json to version their show, and a key pasted into it then ships.
#
#   2. Anything listed in a `.redactions` file, if one exists — one extended regex per line,
#      blank lines and # comments ignored.
#
# 🔴 `.redactions` is GITIGNORED, deliberately. If you extracted this repo from private work,
# the list of names you are scrubbing is itself the sensitive thing. Committing "check that
# these client names never appear" publishes the client list. Keep it local.
set -uo pipefail
cd "$(dirname "$0")/.."

PATTERNS=(
  'sk_[A-Za-z0-9]{20,}'                     # ElevenLabs / OpenAI style keys
  'AKIA[0-9A-Z]{16}'                        # AWS access key id
  '[0-9a-f]{32}\.r2\.cloudflarestorage'     # R2 endpoint carrying an account id
  'BUNNY_ACCESS_KEY=.+'
  'R2_SECRET_ACCESS_KEY=.+'
  'ELEVENLABS_API_KEY=.+'
)
[ -f .redactions ] && while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  PATTERNS+=("$line")
done < .redactions

fail=0
for p in "${PATTERNS[@]}"; do
  hits=$(grep -rInE "$p" . \
    --exclude-dir=.git --exclude-dir=.venv --exclude-dir=node_modules --exclude-dir=output \
    --exclude=check-secrets.sh --exclude=.redactions --exclude=.env --exclude=.env.example 2>/dev/null || true)
  if [ -n "$hits" ]; then
    echo "BLOCKED  /$p/"
    echo "$hits" | sed 's/^/    /'
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "Refusing. Remove these, or add a deliberate exception, then re-run."
  exit 1
fi
echo "clean"
