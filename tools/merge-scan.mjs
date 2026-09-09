// Merges district-scan results (JSON arrays) into data/districts/<XX>.yaml.
// Usage: node tools/merge-scan.mjs scan1.json scan2.json ...
// Matches existing entries by NCES id, else by normalized name; adds new entries otherwise. Keeps files sorted by name.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const norm = s => String(s || "").toLowerCase().replace(/\b(school district|schools|school system|public schools|isd|consolidated|county|co\.?|district|dist)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const VALID = new Set(["allows", "bans", "consent_required", "unknown"]);
let added = 0, updated = 0, skipped = 0;
for (const f of process.argv.slice(2)) {
  for (const r of JSON.parse(readFileSync(f, "utf8"))) {
    if (!VALID.has(r.status)) { console.error(`skip ${r.name}: bad status ${r.status}`); skipped++; continue; }
    if (r.status !== "unknown" && !(r.source && /^https?:\/\//.test(r.source) && r.quote)) { console.error(`skip ${r.name}: ${r.status} without source+quote`); skipped++; continue; }
    const p = join(root, "data/districts", `${r.state}.yaml`);
    const doc = existsSync(p) ? parse(readFileSync(p, "utf8")) : { state: r.state, districts: [] };
    const entry = { name: r.name, county: r.county || null, nces_id: r.nces_id || null, status: r.status, source: r.source || null, quote: r.quote || null, policy_code: r.policy_code || null, crdc_students_latest: r.students_2023_24 ?? null, last_verified: r.last_verified || new Date().toISOString().slice(0, 10), notes: [r.opt_out_or_consent, r.notes, r.status === "unknown" && r.searched ? `Searched: ${[].concat(r.searched).join("; ")}` : null].filter(Boolean).join(" ") || null };
    const i = doc.districts.findIndex(d => (r.nces_id && d.nces_id === r.nces_id) || norm(d.name) === norm(r.name) || (r.county && norm(d.county) === norm(r.county) && norm(d.name).includes(norm(r.county))));
    if (i >= 0) { doc.districts[i] = { ...doc.districts[i], ...entry, name: doc.districts[i].name.length >= entry.name.length ? doc.districts[i].name : entry.name }; updated++; } else { doc.districts.push(entry); added++; }
    doc.districts.sort((a, b) => a.name.localeCompare(b.name));
    writeFileSync(p, `# District corporal punishment policies for ${r.state}. One entry per district.\n# status: allows | bans | consent_required | unknown. Every non-unknown status needs a source URL.\n` + stringify(doc, { lineWidth: 0 }));
  }
}
console.log(`added ${added}, updated ${updated}, skipped ${skipped}`);
