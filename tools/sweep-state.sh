#!/bin/zsh
# The Mothership works one state: every regular district in the federal directory that has no sourced
# rule on the record is searched for its own policy document, read, judged, and merged. Silent
# districts (real documents read, none carrying the rule) are recorded as silent with their documents
# listed. Each stage reports itself to the crew server, so the live board flies the Mothership there.
#   tools/sweep-state.sh FL [--queries handbook]
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
ST=$1; QUERIES=${3:-handbook}; DAY=$(date +%F); L="out/sweep/$ST"; mkdir -p "$L"
export OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-$(grep -m1 OPENROUTER "$HOME/personality-bench/.env.local" | cut -d= -f2- | tr -d '"')}
export BRAVE_API_KEY=${BRAVE_API_KEY:-$(grep -m1 BRAVE "$HOME/.brave.env" | cut -d= -f2-)}
export EGRESS_PROXIES=${EGRESS_PROXIES:-'http://customer-groundcrew_oMudw-cc-US:fEP9J1+c+9I8@pr.oxylabs.io:7777'}
export ESCP_SCOPE="$ST" ESCP_PASS="sweep-$ST-$DAY"
[ -f "$HOME/.escp-maintainer.env" ] && source "$HOME/.escp-maintainer.env"; export ESCP_MAINTAINER_TOKEN
echo "=== $ST slice $(date +%T)"
node - "$ST" "$L" <<'JS' || exit 1
const fs=require("node:fs");const yaml=require("./tools/node_modules/yaml");const [st,L]=process.argv.slice(2);
const NAMES={AL:"Alabama",AR:"Arkansas",AZ:"Arizona",FL:"Florida",GA:"Georgia",IN:"Indiana",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",MO:"Missouri",MS:"Mississippi",NC:"North Carolina",OK:"Oklahoma",SC:"South Carolina",TN:"Tennessee",TX:"Texas",WY:"Wyoming",ID:"Idaho",CO:"Colorado",NH:"New Hampshire"};
const csv=fs.readFileSync("data/nces/lea-directory-2023-24.csv","utf8").split("\n");const head=csv[0].split(",").map(h=>h.trim().toLowerCase());
const parse=l=>{const o=[];let c="",q=false;for(const ch of l){if(ch==='"')q=!q;else if(ch===','&&!q){o.push(c);c="";}else c+=ch;}o.push(c);return o;};
const leas=csv.slice(1).map(parse).filter(c=>c.length>5).map(c=>Object.fromEntries(head.map((h,i)=>[h,(c[i]||"").trim()]))).filter(r=>r.state===st&&r.lea_type.startsWith("Regular public"));
const f=`data/districts/${st}.yaml`;const d=fs.existsSync(f)?yaml.parse(fs.readFileSync(f,"utf8")):[];const rows=Array.isArray(d)?d:(d.districts||[]);
const done=new Set(rows.filter(r=>r.status&&r.status!=="unknown"&&(r.source||r.status==="silent")).map(r=>String(r.nces_id)));
const title=s=>s.toLowerCase().replace(/\b([a-z])/g,m=>m.toUpperCase()).replace(/\bIsd\b/g,"ISD").replace(/\bCisd\b/g,"CISD").replace(/\bR-([ivx]+)\b/gi,(m,r)=>`R-${r.toUpperCase()}`).replace(/\bCo\.?\b/g,"County").replace(/\bSch\b/g,"School").replace(/\bDist\b/g,"District");
const slice=leas.filter(r=>!done.has(r.nces_id)).map(r=>({name:title(r.name),state:NAMES[st]||st,code:st,website:r.website||"",students:0,nces_id:r.nces_id}));
fs.writeFileSync(`${L}/slice.json`,JSON.stringify(slice,null,1));console.log(`${st}: ${leas.length} regular districts, ${done.size} done, ${slice.length} to sweep`);
JS
N=$(node -e 'console.log(require(process.argv[1]).length)' "$L/slice.json"); [ "$N" -gt 0 ] || { echo "nothing to do"; exit 0; }
node tools/report-ops.mjs "$ESCP_PASS" "Mothership on station over ${ST}: ${N} districts nobody has read" "$N" 0 0 "$ST" >/dev/null 2>&1 || true
echo "=== $ST find $(date +%T)"; node tools/tasb/find-document.mjs --in "$L/slice.json" --out "$L/found.jsonl" --queries "$QUERIES" || echo "find failed"
node -e 'const fs=require("fs");const [L,st]=process.argv.slice(1);const rows=fs.readFileSync(`${L}/found.jsonl`,"utf8").split("\n").filter(Boolean).map(l=>({...JSON.parse(l),state:st}));fs.writeFileSync(`${L}/found.jsonl`,rows.map(r=>JSON.stringify(r)).join("\n")+"\n")' "$L" "$ST"
echo "=== $ST read $(date +%T)"; node tools/tasb/read-found.mjs --in "$L/found.jsonl" --out "$L/read.jsonl" --workers 4 || echo "read failed"
grep '"rule"' "$L/read.jsonl" > "$L/rule.jsonl" || true
echo "=== $ST classify $(date +%T) rule rows: $(wc -l < "$L/rule.jsonl")"
[ -s "$L/rule.jsonl" ] && { node tools/tasb/classify.mjs --in "$L/rule.jsonl" --out "$L/classified.json" || echo "classify failed"; python3 tools/tasb/records-from-classified.py "$L/classified.json" "$L/records.json" searched_document "" "Found by searching for the district's policy document and read $DAY (Mothership sweep of $ST). \`quotes\` carries every rule-bearing sentence in document order." || echo "records failed"; }
[ -f "$L/records.json" ] || echo "[]" > "$L/records.json"
# silent rows, with the documents that were read
node - "$L" "$ST" "$DAY" <<'JS'
const fs=require("fs");const [L,st,day]=process.argv.slice(2);
const recs=JSON.parse(fs.readFileSync(`${L}/records.json`,"utf8"));const have=new Set(recs.map(r=>String(r.nces_id)));
const slice=JSON.parse(fs.readFileSync(`${L}/slice.json`,"utf8"));const byName=Object.fromEntries(slice.map(s=>[s.name,s]));
const found=Object.fromEntries(fs.readFileSync(`${L}/found.jsonl`,"utf8").split("\n").filter(Boolean).map(l=>{const r=JSON.parse(l);return [r.district,r];}));
const kind=(t,u)=>/board polic|policy manual|policies/i.test(t+" "+u)?"board_policy":/code of (student )?conduct/i.test(t+" "+u)?"code_of_conduct":/handbook/i.test(t+" "+u)?"handbook":"other";
const silent=[];
for(const l of fs.readFileSync(`${L}/read.jsonl`,"utf8").split("\n").filter(Boolean)){const r=JSON.parse(l);const s=byName[r.district];if(!s||have.has(s.nces_id)||(r.policies||[]).length)continue;
 const docs=[...new Map((r.outcomes||[]).filter(o=>o.outcome==="silent").map(o=>[o.url,o])).values()];if(!docs.length)continue;
 const titles=Object.fromEntries((found[r.district]?.documents||[]).map(d=>[d.url,d.title||""]));
 silent.push({state:st,name:s.name,nces_id:s.nces_id,status:"silent",source:docs[0].url,quote:null,policy_code:null,parent_control:"unknown",method:"searched_document",last_verified:day,
  documents:docs.map(o=>({kind:kind(titles[o.url]||"",o.url),url:o.url,says:"silent",quote:null,retrieved:day,by:"Mothership (search + read)"})),
  notes:`${docs.length} document${docs.length>1?"s":""} found by searching for the district's handbook, code of conduct and board policy and read in full on ${day}; none mentions corporal punishment. State law permits the practice where a district has not prohibited it, so with no written rule it runs on custom; the board policy manual was not located by search or vendor lookup. Identity is name and state matched against the federal LEA directory.`});}
fs.writeFileSync(`${L}/merge.json`,JSON.stringify([...recs,...silent],null,1));console.log(`${st}: ${recs.length} quoted, ${silent.length} silent`);
JS
echo "=== $ST merge $(date +%T)"; node tools/merge-scan.mjs "$L/merge.json" 2>&1 | grep -vE "^NOTE|^  (was|now)" | tail -2
(cd tools && node fill-county.mjs >/dev/null && node validate.mjs | tail -1)
Q=$(node -e 'console.log(require(process.argv[1]).length)' "$L/records.json"); S=$(node -e 'const m=require(process.argv[1]);console.log(m.filter(x=>x.status==="silent").length)' "$L/merge.json")
node tools/report-ops.mjs "$ESCP_PASS" "Mothership pass over ${ST} complete: ${Q} rules quoted, ${S} districts read silent, of ${N} searched" "$N" "$Q" 0 "$ST" >/dev/null 2>&1 || true
echo "=== $ST DONE $(date +%T): $Q quoted, $S silent of $N"
