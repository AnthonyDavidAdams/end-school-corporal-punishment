// Merges district-scan results (JSON arrays) into data/districts/<XX>.yaml.
// Usage: node tools/merge-scan.mjs scan1.json scan2.json ...
// Matches existing entries by NCES id, else by normalized name; adds new entries otherwise. Keeps files sorted by name.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
import { norm, kind, sameName } from "./lib/district-name.mjs";

// The county map already knows every county in every state; there is no reason to guess.
let COUNTIES = null;
const countyKey = (s) => String(s ?? "").toLowerCase().replace(/\s+(county|parish|borough|census area|municipality)$/i, "").replace(/^st\.?\s/, "st ").replace(/[^a-z0-9 ]/g, "").trim();
function countiesOf(state) {
  if (!COUNTIES) {
    COUNTIES = {};
    const svg = readFileSync(join(root, "site/assets/us-map.svg"), "utf8");
    for (const m of svg.matchAll(/data-state="([A-Z]{2})"[^>]*data-name="([^"]+)"|data-name="([^"]+)"[^>]*data-state="([A-Z]{2})"/g)) {
      const st = m[1] ?? m[4], nm = m[2] ?? m[3];
      if (st && nm) (COUNTIES[st] ||= new Set()).add(countyKey(nm));
    }
  }
  return COUNTIES[state] ?? new Set();
}
const VALID = new Set(["allows", "bans", "consent_required", "unknown"]);
let added = 0, updated = 0, skipped = 0;
for (const f of process.argv.slice(2)) {
  for (const r of JSON.parse(readFileSync(f, "utf8"))) {
    if (r.status === undefined && (r.phone_policy || r.ai_policy)) { r.status = null; } else if (!VALID.has(r.status)) { console.error(`skip ${r.name}: bad status ${r.status}`); skipped++; continue; }
    if (r.status !== null && r.status !== "unknown" && !(r.source && /^https?:\/\//.test(r.source) && r.quote)) { console.error(`skip ${r.name}: ${r.status} without source+quote`); skipped++; continue; }
    // Contributors are asked for the district's published contact and it was being dropped on the
    // floor here, which wasted the one moment when someone is already on the district's own site.
    // Empty strings and all-null blocks are discarded so a record is not given a contact it does not
    // have; the federal LEA directory fills phone and address separately.
    const contact = r.contact && Object.entries(r.contact).some(([k, v]) => k !== "as_of" && v)
      ? Object.fromEntries(Object.entries(r.contact).filter(([, v]) => v !== null && v !== ""))
      : null;
    const p = join(root, "data/districts", `${r.state}.yaml`);
    const doc = existsSync(p) ? parse(readFileSync(p, "utf8")) : { state: r.state, districts: [] };
    const entry = r.status === null ? Object.fromEntries(Object.entries({ phone_policy: r.phone_policy, ai_policy: r.ai_policy, start_times: r.start_times, archived_url: r.archived_url, document_text_path: r.document_text_path }).filter(([, v]) => v)) : { name: r.name, county: r.county || null, nces_id: r.nces_id || null, status: r.status, source: r.source || null, quote: r.quote || null, policy_code: r.policy_code || null, crdc_students_latest: r.students_2023_24 ?? null, last_verified: r.last_verified || new Date().toISOString().slice(0, 10), ...(r.phone_policy ? { phone_policy: r.phone_policy } : {}), ...(r.ai_policy ? { ai_policy: r.ai_policy } : {}), ...(r.start_times ? { start_times: r.start_times } : {}), ...(r.archived_url ? { archived_url: r.archived_url } : {}), ...(r.document_text_path ? { document_text_path: r.document_text_path } : {}), ...(contact ? { contact } : {}), notes: [r.opt_out_or_consent, r.notes, r.status === "unknown" && r.searched ? `Searched: ${[].concat(r.searched).join("; ")}` : null].filter(Boolean).join(" ") || null };
        // An NCES id is definitive. Otherwise the names must agree, and a county district may never be
    // matched to a city one: the looser "same county, name contains the county" rule that used to be
    // here matched Talladega City onto Talladega County and overwrote a district that allows corporal
    // punishment with one that prohibits it.
    // An NCES id only wins where the names also agree. A scan carrying a wrong id — and a work order
    // that mis-joins districts will produce those — otherwise matches a completely different row and
    // renames it: Coahoma's id arrived on Choctaw's record and quietly turned Choctaw's row into a
    // second Coahoma. The id is strong evidence of identity, not proof of it.
    const i = doc.districts.findIndex(d =>
      (r.nces_id && d.nces_id && d.nces_id === r.nces_id && sameName(d.name, r.name)) ||
      sameName(d.name, r.name));
    if (i >= 0) {
      const prev = doc.districts[i];
      // A later scan is not automatically a better one. Two ways a merge can quietly make a record
      // worse, both seen in the 2026-09 impact scan:
      //   - county gets overwritten with the town the district office sits in. Monroe County School
      //     District came back as county "Amory", which is a city inside Monroe County and the name of
      //     a different district. A county already on file is kept and the disagreement is reported.
      //   - a board policy citation gets replaced by a handbook citation for the same status. Both are
      //     real sources and the board policy is the governing one, so the swap is reported rather than
      //     made silently; re-run with the record removed if the new source is genuinely better.
      if (prev.county && entry.county && norm(prev.county) !== norm(entry.county)) {
        // Keeping whatever was on file was too blunt. It was written to stop Monroe County's county
        // being overwritten with Amory, the town its office sits in -- and then it kept Longview over
        // Gregg, Covington over Tipton, Vernon over Lamar: four districts whose stored "county" was
        // the city all along and whose scan had it right. So ask the map which of the two is a county
        // in that state, and only fall back to the stored value when that cannot decide.
        const known = countiesOf(r.state);
        const prevIsCounty = known.has(countyKey(prev.county)), entryIsCounty = known.has(countyKey(entry.county));
        if (entryIsCounty && !prevIsCounty) console.error(`county for ${prev.name}: taking "${entry.county}" over "${prev.county}", which is not a county in ${r.state}`);
        else if (prevIsCounty && !entryIsCounty) { console.error(`county for ${prev.name}: keeping "${prev.county}"; scan said "${entry.county}", which is not a county in ${r.state}`); entry.county = prev.county; }
        else { console.error(`county for ${prev.name}: on file "${prev.county}", scan said "${entry.county}", cannot tell which -- keeping the one on file`); entry.county = prev.county; }
      }
      if (prev.source && entry.source && prev.source !== entry.source && prev.status === entry.status) {
        console.error(`NOTE ${prev.name}: source replaced, status unchanged (${prev.status})\n  was ${prev.source}\n  now ${entry.source}`);
      }
      doc.districts[i] = { ...prev, ...entry, name: !entry.name || prev.name.length >= entry.name.length ? prev.name : entry.name };
      updated++;
    } else { doc.districts.push(entry); added++; }
    doc.districts.sort((a, b) => a.name.localeCompare(b.name));
    writeFileSync(p, `# District corporal punishment policies for ${r.state}. One entry per district.\n# status: allows | bans | consent_required | unknown. Every non-unknown status needs a source URL.\n` + stringify(doc, { lineWidth: 0 }));
  }
}
console.log(`added ${added}, updated ${updated}, skipped ${skipped}`);
