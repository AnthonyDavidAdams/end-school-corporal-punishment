// Writes data/outreach/policy-lag.json: districts whose written policy still permits corporal punishment
// (status allows / consent_required / permitted_with_guidance) in a state that has not banned it, and which
// the 2023-24 federal count does not name (no students reported struck). These are the boards the Safe
// Schools Project writes to about bringing the policy into line with the practice.
// Enrollment is summed from the CRDC 2023-24 school enrollment file so the biggest districts come first.
// Usage: node build-policy-lag.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

// Quote-aware CSV line split; district names carry commas.
function splitCsv(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out;
}

export function buildPolicyLag() {
const banned = new Set();
for (const f of readdirSync(join(root, "data/states")).filter((f) => f.endsWith(".yaml"))) {
  const s = parse(readFileSync(join(root, "data/states", f), "utf8"));
  if (s.status === "banned") banned.add(s.code);
}
const struck = new Set(readFileSync(join(root, "data/crdc/2023-24/districts.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(",")[1]));

const lea = new Map();
for (const line of readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8").split("\n").slice(1)) {
  const c = splitCsv(line); if (c.length > 6) lea.set(c[0], { website: c[4], city: c[6] });
}

const enrollment = new Map();
const enrFile = join(root, "tools/crdc/raw/SCH/Enrollment.csv");
if (existsSync(enrFile)) {
  const lines = readFileSync(enrFile, "utf8").split("\n");
  const h = splitCsv(lines[0]); const iLea = h.indexOf("LEAID"); const cols = ["TOT_ENR_M", "TOT_ENR_F", "TOT_ENR_X"].map((k) => h.indexOf(k)).filter((i) => i >= 0);
  for (const line of lines.slice(1)) {
    if (!line) continue; const c = splitCsv(line); const id = c[iLea];
    let n = 0; for (const i of cols) { const v = Number(c[i]); if (v > 0) n += v; } // negatives are CRDC reserve codes
    enrollment.set(id, (enrollment.get(id) || 0) + n);
  }
}

// The federal directory has no website for most Georgia and Louisiana districts. The state contact files
// and the district record itself usually carry one, or at least a superintendent's mailbox whose domain
// is the district's.
const FREEMAIL = /@(gmail|yahoo|hotmail|aol|outlook|icloud|msn|live)\./i;
const fromContacts = new Map();
for (const f of readdirSync(join(root, "data/contacts")).filter((f) => f.endsWith(".json"))) {
  let d; try { d = JSON.parse(readFileSync(join(root, "data/contacts", f), "utf8")); } catch { continue; }
  const list = Array.isArray(d) ? d : Array.isArray(d.rows) ? d.rows : [];
  for (const r of list) {
    if (!r.nces_id) continue;
    const site = r.website || (r.domain ? `https://${r.domain}` : null) || (r.district_email && !FREEMAIL.test(r.district_email) ? `https://${r.district_email.split("@")[1]}` : null);
    if (site && !fromContacts.has(String(r.nces_id))) fromContacts.set(String(r.nces_id), site);
  }
}

const rows = [];
for (const f of readdirSync(join(root, "data/districts")).filter((f) => f.endsWith(".yaml"))) {
  const doc = parse(readFileSync(join(root, "data/districts", f), "utf8"));
  if (banned.has(doc.state)) continue;
  for (const d of doc.districts) {
    if (!["allows", "consent_required", "permitted_with_guidance"].includes(d.status) || !d.nces_id) continue;
    const id = String(d.nces_id);
    if (struck.has(id) || (d.crdc_students_latest || 0) > 0) continue;
    const l = lea.get(id) || {};
    const em = d.contact?.district_email;
    // Last resort: a policy document the district hosts on its own domain names the domain.
    const VENDOR = /tasb|simbli|boarddocs|google|drive\.|docs\.|archive\.org|nces|finalsite\.net|thrillshare|amazonaws|sharpschool|myconnectsuite|edlio|schoolwires|blackboard|cloudfront|squarespace|wixstatic|dropbox|box\.com|core-docs|s3\./i;
    const own = [...(d.documents || []).map((x) => x.url), d.source].filter((u) => u && /^https?:/.test(u) && !VENDOR.test(u)).map((u) => { try { return new URL(u).hostname; } catch { return null; } }).filter(Boolean)[0];
    const website = l.website || d.website || fromContacts.get(id) || (em && !FREEMAIL.test(em) ? `https://${em.split("@")[1]}` : null) || (own ? `https://${own}` : null);
    rows.push({ state: doc.state, name: d.name, nces_id: id, website: website || null, city: l.city || null, enrollment: enrollment.get(id) ?? null, status: d.status,
      quote: d.quote || null, policy_code: d.policy_code || null, source: d.source || null, reported_2023_24: struck.has(id) ? null : 0 });
  }
}
rows.sort((a, b) => (b.enrollment || 0) - (a.enrollment || 0));
return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = buildPolicyLag();
  writeFileSync(join(root, "data/outreach/policy-lag.json"), JSON.stringify(rows, null, 1));
  const byState = {}; for (const r of rows) byState[r.state] = (byState[r.state] || 0) + 1;
  console.log(`${rows.length} districts; ${rows.filter((r) => r.website).length} with a website; ${Object.entries(byState).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join("  ")}`);
}
