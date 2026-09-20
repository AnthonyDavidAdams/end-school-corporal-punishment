// Builds site/data/timeline.json: when each state prohibited corporal punishment, and when each
// district in the record did. It is the data behind the animated map.
//
// Nothing here is invented. A state appears on the timeline only if data/states carries a year_banned;
// a district only if its own policy prints a date. Districts that prohibit it with no date on the
// policy are counted separately and shown as a standing figure, because placing them in a year would
// mean choosing one, and the first thing a viewer would ask is which year and why.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const states = [], districts = [], statesBannedUndated = [];
let undatedBans = 0;
for (const f of readdirSync(join(root, "data/states")).filter(f => f.endsWith(".yaml"))) {
  const s = parse(readFileSync(join(root, "data/states", f), "utf8"));
  if (s.status !== "banned") continue;
  // A state that prohibits it but whose year we do not hold cannot be given one, and it must not be
  // drawn as permitting either: that would make the last frame of the animation wrong about a state
  // where corporal punishment is illegal. It is carried separately and drawn as prohibiting throughout.
  if (s.year_banned) states.push({ code: s.code, name: s.name, year: Number(s.year_banned) });
  else statesBannedUndated.push({ code: s.code, name: s.name });
}
states.sort((a, b) => a.year - b.year);

for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) {
  const doc = parse(readFileSync(join(root, "data/districts", f), "utf8"));
  for (const d of doc.districts) {
    if (d.status !== "bans" || !d.source) continue;
    const when = d.policy_revised || d.policy_adopted || null;
    if (!when) { undatedBans++; continue; }
    districts.push({
      state: doc.state, name: d.name, county: d.county ?? null, date: when,
      year: Number(when.slice(0, 4)),
      students: d.crdc_students_latest ?? null,
      // Weaker provenance travels with the row rather than being flattened away.
      from: d.policy_dates_from ?? "policy",
    });
  }
}
districts.sort((a, b) => a.date.localeCompare(b.date));

mkdirSync(join(root, "site/data"), { recursive: true });
writeFileSync(join(root, "site/data/timeline.json"), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  first_year: states.length ? states[0].year : null,
  last_year: Math.max(...districts.map(d => d.year), ...states.map(s => s.year)),
  states, districts, states_banned_undated: statesBannedUndated,
  districts_prohibiting_without_a_date: undatedBans,
  note: "State years are the year the state prohibited corporal punishment in public schools. District dates are the date printed on that district's own policy, which is usually the date it was last revised. Districts prohibiting with no date on the policy are counted but not placed in time.",
}, null, 1));
console.log(`timeline: ${states.length} dated states ${states[0]?.year}-${states[states.length - 1]?.year}, ${statesBannedUndated.length} banned states with no year (${statesBannedUndated.map(s => s.code).join(", ")}), ${districts.length} dated districts, ${undatedBans} districts prohibiting without a date`);
