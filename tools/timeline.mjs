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
    // A policy with no date on it still prohibits corporal punishment, and leaving those districts off
    // the map entirely was worse than placing them imperfectly: thirty of the forty-nine were invisible.
    // They go on at the date this project first recorded them, which is the earliest date anyone here
    // can stand behind, and every one is marked so the map can draw it as what it is -- the date we
    // found out, not the date they decided. Dating them properly is its own task, date-the-change.
    const when = d.policy_revised || d.policy_adopted || null;
    const at = when || d.last_verified || null;
    if (!at) { undatedBans++; continue; }
    if (!when) undatedBans++;
    districts.push({
      state: doc.state, name: d.name, county: d.county ?? null, nces_id: d.nces_id ?? null, date: at,
      year: Number(at.slice(0, 10).slice(0, 4)),
      students: d.crdc_students_latest ?? null,
      // Weaker provenance travels with the row rather than being flattened away.
      from: when ? (d.policy_dates_from ?? "policy") : "first_recorded",
      dated: Boolean(when),
    });
  }
}
districts.sort((a, b) => a.date.localeCompare(b.date));

// Milestones come out of the claims registry rather than being typed here, so each one on the map is a
// claim somebody sourced and verified, and carries its id for anyone who wants to check it. The list is
// explicit rather than selected by tag: a tag filter would pull in every statistic in the registry, and
// what belongs on a timeline is things that happened on a date.
const MILESTONES = [
  ["law-ingraham-v-wright-1977", "The Supreme Court rules school corporal punishment is not cruel and unusual punishment"],
  ["org-aft-1976-no-opposition", "The American Federation of Teachers declines to oppose corporal punishment"],
  ["org-national-pta", "The National PTA calls for an end to corporal punishment in schools"],
  ["law-new-mexico-hb172-2011", "New Mexico becomes the 31st state to prohibit it"],
  ["org-aacap-2012", "The American Academy of Child and Adolescent Psychiatry opposes it"],
  ["org-nwlc-open-letter-2016", "A coalition of national organizations writes to every governor and chief state school officer"],
  ["campaign-north-carolina-all-districts-2018", "The last district in North Carolina stops, ending the practice statewide without a law"],
  ["org-aap-2018-effective-discipline", "The American Academy of Pediatrics calls for abolition"],
  ["org-apa-2019-parental-resolution", "The American Psychological Association adopts its resolution"],
  ["org-nasp-position", "The National Association of School Psychologists takes its position"],
  ["law-colorado-hb23-1191", "Colorado prohibits it"],
  ["law-idaho-hb281-2023", "Idaho prohibits it"],
  ["campaign-kentucky-zero-2023-24", "Kentucky reaches zero without a statewide ban"],
  ["law-circuit-split-fifth-circuit", "A federal circuit split opens over whether students can sue"],
  ["law-federal-possa-2025", "The Protecting Our Students in Schools Act is reintroduced in Congress"],
  ["law-oklahoma-sb364-2025", "Oklahoma prohibits it for students with disabilities"],
  ["law-florida-hb1255-2025", "Florida narrows it"],
];
const milestones = [];
for (const [id, label] of MILESTONES) {
  const f = join(root, "facts/claims", `${id}.md`);
  let front;
  try { front = readFileSync(f, "utf8").split("---")[1]; } catch { console.error(`milestone ${id}: no such claim, skipped`); continue; }
  const meta = parse(front);
  if (meta.status !== "verified") { console.error(`milestone ${id}: status is ${meta.status}, skipped`); continue; }
  // as_of is sometimes a full date, sometimes a year, sometimes a school year like "2023-24".
  const y = String(meta.as_of ?? "").match(/(18|19|20)\d{2}/)?.[0];
  if (!y) { console.error(`milestone ${id}: no year in as_of "${meta.as_of}", skipped`); continue; }
  milestones.push({ year: Number(y), id, label, claim: meta.claim ?? null, source: meta.sources?.[0]?.url ?? null });
}
milestones.sort((a, b) => a.year - b.year);

mkdirSync(join(root, "site/data"), { recursive: true });
writeFileSync(join(root, "site/data/timeline.json"), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  first_year: states.length ? states[0].year : null,
  last_year: Math.max(...districts.map(d => d.year), ...states.map(s => s.year)),
  states, districts, milestones, states_banned_undated: statesBannedUndated,
  districts_prohibiting_without_a_date: undatedBans,
  note: "State years are the year the state prohibited corporal punishment in public schools. District dates are the date printed on that district's own policy, which is usually the date it was last revised. Districts prohibiting with no date on the policy are counted but not placed in time.",
}, null, 1));
console.log(`timeline: ${districts.filter(d => d.dated).length} districts on their policy date, ${districts.filter(d => !d.dated).length} on the date we first recorded them, ${milestones.length} milestones, ${states.length} dated states ${states[0]?.year}-${states[states.length - 1]?.year}, ${statesBannedUndated.length} banned states with no year (${statesBannedUndated.map(s => s.code).join(", ")}), ${districts.length} dated districts, ${undatedBans} districts prohibiting without a date`);
