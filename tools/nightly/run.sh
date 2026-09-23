#!/bin/zsh
# One night's work, unattended: take the next slice off the worklist, scan it, verify every quote
# against its live source, merge what passes, rebuild and deploy.
#
# The only step that uses a model is the scan. Everything that touches the record -- verification,
# merging, the audit -- is the same deterministic code that has been catching mistakes by hand all
# along. A model is never the last thing between a finding and the public record.
#
# Run by launchd; see com.earthpilot.escp-nightly.plist. Logs to out/nightly/<date>/.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
REPO="$PWD"
DAY=$(date +%Y-%m-%d)
LOG="$REPO/out/nightly/$DAY"
mkdir -p "$LOG"
exec > >(tee -a "$LOG/run.log") 2>&1
echo "=== $(date -u +%FT%TZ) nightly start"

SLICE=${ESCP_NIGHTLY_SLICE:-120}    # districts per night. 120 is roughly 200 agents, well under the
                                    # 1000 cap, and finishes the federal-count districts in about six
                                    # nights instead of eleven.

# 1. Take the next slice. Skips ban-state filings, which are a reporting question and not a policy read.
node - "$SLICE" <<'JS' > "$LOG/slice.json" || { echo "slice failed"; exit 1; }
const fs = require("node:fs");
const n = Number(process.argv[2] ?? 60);
const wl = JSON.parse(fs.readFileSync("site/data/worklist.json", "utf8"));
const open = wl.districts.filter(d => !d.flag).slice(0, n);
const byState = {};
for (const d of open) (byState[d.state] ||= []).push(d);
process.stdout.write(JSON.stringify(Object.entries(byState).map(([state, districts]) => ({ state, districts }))));
JS
COUNT=$(node -e 'const s=require(process.argv[1]);console.log(s.reduce((a,x)=>a+x.districts.length,0))' "$LOG/slice.json")
echo "slice: $COUNT districts"
[ "$COUNT" -gt 0 ] || { echo "worklist empty, nothing to do"; exit 0; }

# 2. Scan. Claude Code runs the workflow on the Max plan; no API spend.
claude -p "Run the workflow at $REPO/tools/night-run.workflow.js with the districts in $LOG/slice.json as its args. Read that file and pass its contents as the args value. When it finishes, write the workflow's findings array as JSON to $LOG/found.json and nothing else. Do not merge anything, do not edit the record, do not commit." \
  --permission-mode acceptEdits > "$LOG/scan.log" 2>&1
[ -s "$LOG/found.json" ] || { echo "no findings written; see scan.log"; exit 1; }
echo "scanned: $(node -e 'console.log(require(process.argv[1]).length)' "$LOG/found.json") findings"

# 3. Verify every quote against its live source. This is the gate.
node tools/verify-scan.mjs "$LOG/found.json" > "$LOG/verify.log" 2>&1
VERIFIED="${LOG}/found.verified.json"
[ -s "$VERIFIED" ] || { echo "nothing verified; see verify.log"; exit 0; }
echo "verified: $(node -e 'console.log(require(process.argv[1]).length)' "$VERIFIED")"

# 4. Merge, with a copy kept so the audit can prove nothing was lost.
cp -r data/districts "$LOG/districts-before"
node tools/merge-scan.mjs "$VERIFIED" 2>&1 | tail -20
node tools/crdc/join.mjs --write >/dev/null 2>&1
node tools/nces/backfill.mjs --write >/dev/null 2>&1
node tools/dates/extract.mjs --write >/dev/null 2>&1

# 5. Audit and validate. Either failing stops the night without touching the site.
node - "$LOG/districts-before" <<'JS' || { echo "AUDIT FAILED -- record left uncommitted"; exit 1; }
const fs = require("node:fs"), Y = require("./tools/node_modules/yaml");
const before = process.argv[2];
let lost = 0;
for (const f of fs.readdirSync(before).filter(x => x.endsWith(".yaml"))) {
  const b = Y.parse(fs.readFileSync(`${before}/${f}`, "utf8"));
  const after = Y.parse(fs.readFileSync(`data/districts/${f}`, "utf8")).districts;
  const byId = new Map(after.filter(d => d.nces_id).map(d => [d.nces_id, d]));
  const byName = new Map(after.map(d => [d.name, d]));
  for (const x of b.districts) if (!((x.nces_id && byId.get(x.nces_id)) || byName.get(x.name))) { console.error(`LOST ${b.state} ${x.name}`); lost++; }
}
if (lost) process.exit(1);
console.log("audit: no pre-existing record lost");
JS
node tools/validate.mjs | tail -1 || { echo "VALIDATION FAILED -- record left uncommitted"; exit 1; }

# 6. Publish.
npm --prefix tools run build-site 2>&1 | tail -3
git add data site
git commit -q -m "Nightly scan $DAY: $(node -e 'console.log(require(process.argv[1]).length)' "$VERIFIED") districts verified and merged

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" || echo "nothing to commit"
git push -q origin main && echo "pushed"
if [ -f "$HOME/.escp-deploy.env" ]; then
  export $(grep -v '^#' "$HOME/.escp-deploy.env" | xargs)
  sshpass -p "$DEPLOY_PASS" rsync -az --exclude og.html --exclude 'policies/' \
    -e "ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no" \
    site/ "$DEPLOY_HOST:$DEPLOY_PATH" && echo "deployed"
fi

# 7. What the morning should know.
node - "$LOG" > "$LOG/summary.txt" <<'JS'
const fs = require("node:fs"), Y = require("./tools/node_modules/yaml");
const log = process.argv[2];
const wl = JSON.parse(fs.readFileSync("site/data/worklist.json", "utf8"));
let sourced = 0, bans = 0;
for (const f of fs.readdirSync("data/districts").filter(x => x.endsWith(".yaml")))
  for (const d of Y.parse(fs.readFileSync(`data/districts/${f}`, "utf8")).districts)
    if (d.source) { sourced++; if (d.status === "bans") bans++; }
const v = JSON.parse(fs.readFileSync(`${log}/found.verified.json`, "utf8"));
const stopped = v.filter(r => r.status === "bans");
console.log(`merged ${v.length} districts. ${sourced} sourced in the record, ${bans} prohibit.`);
console.log(`worklist: ${wl.unchecked} left, ${wl.students_in_unchecked.toLocaleString()} children.`);
if (stopped.length) {
  console.log(`\nDISTRICTS THAT STOPPED (${stopped.length}):`);
  for (const r of stopped) console.log(`  ${r.state} ${r.name} -- ${r.students_2023_24 ?? "?"} struck in 2023-24, now prohibits`);
}
try {
  const failed = JSON.parse(fs.readFileSync(`${log}/found.failed.json`, "utf8"));
  if (failed.length) { console.log(`\nnot merged (${failed.length}):`); for (const r of failed) console.log(`  ${r.state} ${r.name}: ${r._why.slice(0, 90)}`); }
} catch {}
JS
cat "$LOG/summary.txt"
echo "=== $(date -u +%FT%TZ) nightly done"
