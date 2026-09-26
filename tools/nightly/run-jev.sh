#!/bin/zsh
# One night's work, unattended, on the Mothership pipeline: take the next slice of unchecked
# districts, search for each one's policy document (Brave + Jev ranking), read what is found,
# classify with Jev (clip-and-decide: the quote is one of our own clipped sentences, so it is
# verbatim by construction), merge what clears the confidence bar, validate, rebuild, publish.
# No frontier model runs at night. Anything held below the bar waits in out/nightly/<date>/ for
# a reviewer. Any step failing stops the night with the record uncommitted.
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/../.." || exit 1
REPO="$PWD"; DAY=$(date +%Y-%m-%d); LOG="$REPO/out/nightly/$DAY"; mkdir -p "$LOG"
exec > >(tee -a "$LOG/run.log") 2>&1
echo "=== $(date -u +%FT%TZ) nightly (jev) start"
export OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-$(grep -m1 OPENROUTER "$HOME/personality-bench/.env.local" | cut -d= -f2- | tr -d '"')}
export BRAVE_API_KEY=${BRAVE_API_KEY:-$(grep -m1 BRAVE "$HOME/.brave.env" | cut -d= -f2-)}
[ -f "$HOME/.escp-deploy.env" ] && source "$HOME/.escp-deploy.env"
SLICE=${ESCP_NIGHTLY_SLICE:-60}

# 1. The slice: unchecked districts, most children first, that were not searched in the last 14 days.
npm --prefix tools run build-worklist >/dev/null 2>&1
node - "$SLICE" "$LOG" <<'JS' || { echo "slice failed"; exit 1; }
const fs = require("node:fs"); const [n, log] = [Number(process.argv[2]), process.argv[3]];
const wl = JSON.parse(fs.readFileSync("site/data/worklist.json", "utf8"));
const seen = fs.existsSync("data/handbooks/nightly-searched.json") ? JSON.parse(fs.readFileSync("data/handbooks/nightly-searched.json", "utf8")) : {};
const cutoff = Date.now() - 14 * 86400e3;
const slice = wl.districts.filter(d => !(seen[`${d.state}|${d.name}`] > cutoff)).slice(0, n)
  .map(d => ({ name: d.name, state: d.state, website: d.website || "", students: d.students || 0, nces_id: d.nces_id }));
for (const d of slice) seen[`${d.state}|${d.name}`] = Date.now();
fs.writeFileSync(`${log}/slice.json`, JSON.stringify(slice, null, 1));
fs.writeFileSync("data/handbooks/nightly-searched.json", JSON.stringify(seen));
console.log(`slice: ${slice.length} districts`);
JS
[ "$(node -e 'console.log(require(process.argv[1]).length)' "$LOG/slice.json")" -gt 0 ] || { echo "nothing to do"; exit 0; }

# 2. Find, read, classify. Each is deterministic apart from Jev's typed decisions.
node tools/tasb/find-document.mjs --in "$LOG/slice.json" --out "$LOG/found.jsonl" || { echo "find failed"; exit 1; }
node tools/tasb/read-found.mjs --in "$LOG/found.jsonl" --out "$LOG/read.jsonl" --workers 4 || { echo "read failed"; exit 1; }
grep '"rule"' "$LOG/read.jsonl" > "$LOG/rule.jsonl" || true
[ -s "$LOG/rule.jsonl" ] || { echo "no document carried the rule tonight"; exit 0; }
node tools/tasb/classify.mjs --in "$LOG/rule.jsonl" --out "$LOG/classified.json" || { echo "classify failed"; exit 1; }
python3 tools/tasb/records-from-classified.py "$LOG/classified.json" "$LOG/records.json" searched_document "" "Found by searching for the district's policy document and read $DAY (nightly). \`quotes\` carries every rule-bearing sentence in document order." || { echo "records failed"; exit 1; }
node -e 'const c=require(process.argv[1]);const h=c.filter(x=>x.decision!=="record");require("fs").writeFileSync(process.argv[2],JSON.stringify(h,null,1));console.log(`held for review: ${h.length}`)' "$LOG/classified.json" "$LOG/held.json"

# 3. Merge, validate, publish. A failed validation leaves the tree dirty and the site untouched.
cp -r data/districts "$LOG/districts.before"
node tools/merge-scan.mjs "$LOG/records.json" 2>&1 | grep -vE "^NOTE|^  (was|now)" | tail -3
(cd tools && node fill-county.mjs && node validate.mjs | tail -1 | grep -q "0 failures") || { echo "validation failed; not publishing"; exit 1; }
npm --prefix tools run build-site 2>&1 | tail -1
git add data/districts data/handbooks/nightly-searched.json site && git commit -q -m "Nightly $DAY: $(node -e 'console.log(require(process.argv[1]).length)' "$LOG/records.json") districts recorded by the Mothership

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push -q origin main && echo pushed
if [ -n "${DEPLOY_PASS:-}" ]; then sshpass -p "$DEPLOY_PASS" rsync -az --delete --exclude documents --exclude og.html --exclude news.php --exclude icon.php -e "ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no" site/ "$DEPLOY_HOST:$DEPLOY_PATH" && echo deployed; fi
echo "=== $(date -u +%FT%TZ) nightly done: $(node -e 'console.log(require(process.argv[1]).length)' "$LOG/records.json") recorded, held in $LOG/held.json"
