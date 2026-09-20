// Joins data/districts/<XX>.yaml records to the 832 districts in the 2023-24 federal count and reports
// what each record's own number is. Read-only by default; --write fills crdc_students_latest.
//
// A district's own figure is the only number that means anything to that district's board, so the join
// has to be right rather than generous. Two rules keep it honest:
//   - an NCES id matches only where the names also agree (a work order carrying a wrong id otherwise
//     renames a different district: that is how Coahoma's id landed on Choctaw's record);
//   - a county district never matches a city district of the same name. They are separate districts
//     with separate boards and, in the case of Talladega, opposite policies.
// Anything that does not match cleanly is reported, not guessed.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const write = process.argv.includes("--write");

// The federal file and the project's records name the same district differently: "Dale County Board of
// Education (Dale County Schools)" against "Dale County", "CARROLL COUNTY SCHOOL DIST" against "Carroll
// County Schools". Every one of those noise words is dropped. What is never dropped is "county" and
// "city", which kind() guards: they are the whole difference between two real districts.
import { norm, kind } from "../lib/district-name.mjs";

// districts.csv: state,nces_id,district,students
const rows = readFileSync(join(root, "data/crdc/2023-24/districts.csv"), "utf8").trim().split("\n").slice(1).map(l => {
  const [state, nces_id, ...rest] = l.split(",");
  const students = Number(rest.pop());
  return { state, nces_id, name: rest.join(","), students };
});
const byId = new Map(rows.map(r => [r.nces_id, r]));
const byName = new Map();
for (const r of rows) { const k = `${r.state}|${norm(r.name)}|${kind(r.name)}`; (byName.get(k) || byName.set(k, []).get(k)).push(r); }
// Loosening the name rule is only safe while it still tells every district apart. If two federal rows
// in one state collapse to the same key, the rule has gone too far and the join would be a coin flip.
const collided = [...byName.entries()].filter(([, v]) => v.length > 1);
if (collided.length) { console.log(`WARNING: ${collided.length} federal keys are shared by more than one district; those are reported as ambiguous below.`); }

const out = { matched_id: 0, matched_name: 0, zero: 0, ambiguous: [], id_name_disagree: [], hits: [] };
for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) {
  const p = join(root, "data/districts", f);
  let text = readFileSync(p, "utf8");
  const doc = parse(text);
  for (const d of doc.districts) {
    if (!d.source) continue;                       // only records someone has actually opened
    let hit = null, how = null;
    if (d.nces_id && byId.has(d.nces_id)) {
      const c = byId.get(d.nces_id);
      if (norm(c.name) === norm(d.name) && kind(c.name) === kind(d.name)) { hit = c; how = "id"; }
      else out.id_name_disagree.push({ state: doc.state, record: d.name, id: d.nces_id, crdc: c.name, students: c.students });
    }
    if (!hit) {
      const cands = byName.get(`${doc.state}|${norm(d.name)}|${kind(d.name)}`) || [];
      if (cands.length === 1) { hit = cands[0]; how = "name"; }
      else if (cands.length > 1) out.ambiguous.push({ state: doc.state, record: d.name, candidates: cands.map(c => `${c.name} (${c.nces_id}, ${c.students})`) });
    }
    // Absent from the 832 is NOT the same as zero. The 2023-24 collection carries the -5 missing-data
    // code on 1,611 schools, so a district can be missing from the list because it reported none or
    // because it reported nothing at all, and the public-use file does not say which. A letter that
    // tells a board "the federal count says you struck no one" had better be true, so a district that
    // did not match keeps a null and no claim is made about it.
    const students = hit ? hit.students : null;
    if (hit) { out[how === "id" ? "matched_id" : "matched_name"]++; out.hits.push({ state: doc.state, name: d.name, how, id: hit.nces_id, students, had: d.crdc_students_latest }); }
    else out.zero++;
    if (write && students !== null && d.crdc_students_latest !== students) {
      // Line-level patch, never a YAML round trip: safe_dump once turned "0100270" into an octal int
      // and "8:05" into a sexagesimal one. Only this one scalar is rewritten.
      const key = d.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(  - name: ${key}\\n(?:    .*\\n|      .*\\n)*?    crdc_students_latest: )[^\\n]*`);
      if (re.test(text)) text = text.replace(re, `$1${students}`);
      else out.ambiguous.push({ state: doc.state, record: d.name, candidates: ["no crdc_students_latest line to patch"] });
    }
  }
  if (write) writeFileSync(p, text);
}
const struck = out.hits.reduce((a, h) => a + h.students, 0);
console.log(`matched by id ${out.matched_id}, by name ${out.matched_name}, not in the federal list ${out.zero} (left null: absent is not the same as zero)`);
console.log(`students struck in the matched districts: ${struck}`);
if (out.id_name_disagree.length) { console.log(`\nid points at a different district (${out.id_name_disagree.length}) — not joined:`); for (const x of out.id_name_disagree) console.log(`  ${x.state} ${x.record} -> id ${x.id} is ${x.crdc} (${x.students})`); }
if (out.ambiguous.length) { console.log(`\nambiguous (${out.ambiguous.length}) — not joined:`); for (const x of out.ambiguous) console.log(`  ${x.state} ${x.record}: ${x.candidates.join(" | ")}`); }
console.log(`\ntop matched:`);
for (const h of out.hits.sort((a, b) => b.students - a.students).slice(0, 25)) console.log(`  ${String(h.students).padStart(4)}  ${h.state} ${h.name} (${h.how})`);
