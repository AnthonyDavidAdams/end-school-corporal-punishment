// Writes site/data/worklist.json: the districts the federal count names that nobody here has checked,
// ranked by how many students they struck. It is the project's own to-do list, in public, with a number
// attached to every line so a contributor can see what one hour of their agent's time is worth.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { norm, kind } from "../lib/district-name.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const rows = readFileSync(join(root, "data/crdc/2023-24/districts.csv"), "utf8").trim().split("\n").slice(1).map(l => {
  const [state, nces_id, ...rest] = l.split(",");
  return { state, nces_id, name: rest.join(",").replace(/,(?=[^,]*$)/, "\u0000").split("\u0000")[0], students: Number(rest[rest.length - 1]) };
});

// Contact and website from the federal LEA directory, so a line in the worklist tells a contributor
// where the district actually is before they start looking for it.
const leaText = readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8");
const lea = new Map();
for (const line of leaText.split("\n").slice(1)) {
  const c = line.split(",");
  if (c.length > 5) lea.set(c[0], { website: c[4], city: c[6] });
}

// Everything already opened, by id and by name, so a district is not offered twice.
const doneId = new Set(), doneName = new Set(); const silent = new Map();
const states = new Set();
for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) {
  const doc = parse(readFileSync(join(root, "data/districts", f), "utf8"));
  for (const d of doc.districts) {
    // Done means the district's own rule is quoted. A record whose only source is a handbook that says
    // nothing (status "silent") is not done: the board policy is still out there, and that is exactly
    // the job a browsing agent can do. 1,069 such districts sat off the worklist until 2026-10-11.
    if (!d.quote) { if (["silent", "unknown"].includes(d.status) && d.nces_id) silent.set(String(d.nces_id), { state: doc.state, name: d.name, note: d.status === "silent" ? "handbook or site read, no rule found; the board policy manual is the document to find" : "nothing read yet" }); continue; }
    if (d.nces_id) doneId.add(d.nces_id);
    doneName.add(`${doc.state}|${norm(d.name)}|${kind(d.name)}`);
  }
}
for (const f of readdirSync(join(root, "data/states")).filter(f => f.endsWith(".yaml"))) {
  const s = parse(readFileSync(join(root, "data/states", f), "utf8"));
  states.add(JSON.stringify([s.code, s.status]));
}
const banned = new Set([...states].map(s => JSON.parse(s)).filter(([, st]) => st === "banned").map(([c]) => c));

// A district in a state that prohibits the practice is not "unchecked": its filing is the anomaly, and the
// project has written that up as a claim. Nineteen of them sat on the worklist for two weeks reading as
// unread policies that a scan would settle. Counted separately, never as work.
// Districts with no quoted rule that the federal count does not name (no students struck, or not filed)
// go on the list after the ones it does, so the biggest counts still come first.
const inCrdc = new Set(rows.map(r => r.nces_id));
const extra = [...silent.entries()].filter(([id, d]) => !inCrdc.has(id) && !banned.has(d.state)).map(([id, d]) => ({ state: d.state, nces_id: id, name: d.name, students: 0 }));
const open = [...rows, ...extra]
  .filter(r => !banned.has(r.state))
  .filter(r => !doneId.has(r.nces_id) && !doneName.has(`${r.state}|${norm(r.name)}|${kind(r.name)}`))
  .sort((a, b) => b.students - a.students)
  .map(r => ({
    state: r.state, nces_id: r.nces_id, name: r.name, students: r.students,
    ...(lea.get(r.nces_id) || {}),
    ...(silent.get(r.nces_id) ? { read: silent.get(r.nces_id).note } : {}),
    // A ban-state district reporting students struck is either a filing error or a serious story, and
    // either way it is not the routine "read the policy, it permits it" job the rest of this list is.
    ...(banned.has(r.state) ? { flag: "state prohibits corporal punishment: this filing needs explaining, not a routine scan" } : {}),
  }));

const byState = {};
for (const r of open) byState[r.state] = (byState[r.state] || 0) + 1;
mkdirSync(join(root, "site/data"), { recursive: true });
writeFileSync(join(root, "site/data/worklist.json"), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: "US Department of Education, Civil Rights Data Collection 2023-24, computed by this project; see data/crdc/2023-24/SOURCE.md",
  total_districts_in_federal_count: rows.length,
  unchecked: open.length,
  ban_state_filing_anomalies: rows.filter(r => banned.has(r.state) && !doneId.has(r.nces_id)).length,
  students_in_unchecked: open.reduce((a, r) => a + r.students, 0),
  by_state: Object.fromEntries(Object.entries(byState).sort((a, b) => b[1] - a[1])),
  districts: open,
}, null, 1));
console.log(`${open.length} unchecked of ${rows.length}; ${open.reduce((a, r) => a + r.students, 0).toLocaleString()} students`);
console.log(Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s, n]) => `${s} ${n}`).join("  "));
