#!/bin/zsh
# The association policy portals, read every night for whatever is still unquoted. Each harvester is
# resumable and only tries districts the record does not yet quote, so a night with nothing new costs
# nothing. New rows are classified by Jev, turned into records, and merged; publishing is the nightly's.
#
#   tools/portals/nightly.sh            run every portal in the manifest
#   tools/portals/nightly.sh KY         one state
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/../.." || exit 1
export OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-$(grep -m1 OPENROUTER "$HOME/personality-bench/.env.local" | cut -d= -f2- | tr -d '"')}
DAY=$(date +%Y-%m-%d); OUT="out/portals/$DAY"; mkdir -p "$OUT"
# state | harvester | jsonl | policy code | note
MANIFEST="
KY|tools/ky/ksba-harvest.mjs|data/handbooks/ksba-ky.jsonl|09.433|Read from the district's board policy manual on the KSBA policy portal (policy.ksba.org)
IN|tools/in/neola-harvest.mjs|data/handbooks/neola-in.jsonl||Read from the district's board policy manual (Neola, policy 5630)
"
echo "$MANIFEST" | grep -v '^\s*$' | while IFS='|' read -r ST HARV JSONL CODE NOTE; do
  [ -n "${1:-}" ] && [ "$1" != "$ST" ] && continue
  [ -f "$HARV" ] || { echo "$ST: no harvester at $HARV"; continue; }
  before=$( [ -f "$JSONL" ] && wc -l < "$JSONL" || echo 0 )
  node "$HARV" 2>&1 | tail -1
  after=$( [ -f "$JSONL" ] && wc -l < "$JSONL" || echo 0 )
  new=$(( after - before ))
  if [ "$new" -le 0 ]; then echo "$ST: nothing new"; continue; fi
  tail -n "$new" "$JSONL" > "$OUT/$ST.jsonl"
  node tools/tasb/classify.mjs --in "$OUT/$ST.jsonl" --out "$OUT/$ST-classified.json" 2>&1 | tail -1
  python3 tools/tasb/records-from-classified.py "$OUT/$ST-classified.json" "$OUT/$ST-records.json" portal_harvest "$CODE" "$NOTE, $DAY." 2>&1 | tail -1
  [ -s "$OUT/$ST-records.json" ] && node tools/merge-scan.mjs "$OUT/$ST-records.json" 2>&1 | grep -v "^NOTE\|^  was\|^  now" | tail -2
done
