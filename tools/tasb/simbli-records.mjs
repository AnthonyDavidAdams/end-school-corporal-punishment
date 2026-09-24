// Turn classified Simbli districts into records, refusing anything whose identity is not certain.
//
// Simbli's site numbers are a global sequence, not a per-state block, so a harvest of one range picks
// up districts from many states and the manual never names the state. Identity therefore comes from
// matching the district's own name against the federal directory -- and a name alone is not always
// enough: "Jackson County" exists in a dozen states. Where the name matches more than one district,
// the record gets nothing. A wrong district on a public map is worse than a gap in it, and a gap is
// visible while a wrong row is not.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const today = new Date().toISOString().slice(0, 10);
const cls = JSON.parse(readFileSync(join(root, "data/simbli/classified.json"), "utf8"));

const dir = readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8").split("\n");
const head = dir[0].split(",").map((h) => h.trim().toLowerCase());
const col = (c, n) => c[head.indexOf(n)]?.trim() ?? "";
const norm = (n) => (n || "").toLowerCase()
  .replace(/school district|public schools|schools|school system/g, "")
  .replace(/[^a-z0-9]/g, "").trim();

const byName = new Map();
for (const line of dir.slice(1)) {
  const c = line.split(",");
  if (c.length < 4) continue;
  const k = norm(col(c, "name"));
  if (!k) continue;
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push({ state: col(c, "state"), nces_id: col(c, "nces_id"), county: col(c, "county"), name: col(c, "name") });
}

const out = [], skipped = { ambiguous: 0, unmatched: 0, held: 0 };
for (const r of cls) {
  if (r.decision !== "record" || !r.quote) { skipped.held++; continue; }
  const m = byName.get(norm(r.district));
  if (!m) { skipped.unmatched++; continue; }
  if (m.length > 1) { skipped.ambiguous++; continue; }
  const d = m[0];
  out.push({
    state: d.state,
    name: d.name,
    nces_id: d.nces_id || undefined,
    county: d.county || undefined,
    status: r.status,
    source: r.source,
    quote: r.quote,
    policy_code: r.policy_code ?? null,
    last_verified: today,
    notes: `Board policy ${r.policy_code ?? ""} from the district's own manual on Simbli (eBOARDsolutions), read ${today}. Identified by matching the district's name in its manual against the federal LEA directory; the manual does not state a state, so any name matching more than one district was left out rather than guessed.`.replace(/\s+/g, " "),
  });
}
writeFileSync(join(root, "data/simbli/records.json"), JSON.stringify(out, null, 1));
const by = {};
for (const r of out) by[r.state] = (by[r.state] || 0) + 1;
console.log(`${out.length} records | skipped: ${JSON.stringify(skipped)}`);
console.log(`by state: ${JSON.stringify(by)}`);
