#!/usr/bin/env bash
# Fail-closed check for things that must never reach a public repo.
# Run before every push. A public repo derived from private work is exactly how client
# identifiers and credentials escape — so this refuses rather than warns.
set -uo pipefail
cd "$(dirname "$0")/.."

PATTERNS=(
  'sk_[A-Za-z0-9]{20,}'                                   # API keys
  'AKIA[0-9A-Z]{16}'                                      # AWS access key ids
  '[0-9a-f]{32}\.r2\.cloudflarestorage'                   # R2 endpoint with account id
  '[0-9]{3}[ .-][0-9]{3}[ .-][0-9]{4}'                    # phone numbers
)
# Names, domains and voice ids from whatever you built this from. Fill this in.
NAMES=()

fail=0
for p in "${PATTERNS[@]}" ${NAMES[@]+"${NAMES[@]}"}; do
  hits=$(grep -rInE "$p" . \
    --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=output \
    --exclude=check-clean.sh 2>/dev/null | grep -v 'example\.com' || true)
  if [ -n "$hits" ]; then
    echo "BLOCKED  /$p/"
    echo "$hits" | sed 's/^/    /'
    fail=1
  fi
done

[ "$fail" -ne 0 ] && { echo; echo "Refusing. Remove these, or add a deliberate exception, then re-run."; exit 1; }
echo "clean"
