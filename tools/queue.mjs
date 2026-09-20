// Counts what is actually claimable for each task in the queue, so the contribute page can say
// "159 districts need a contact" instead of "contact capture: one state".
//
// A task list with no numbers on it reads as a menu of ideas. The numbers are what make it a queue,
// and they are computed from the record so they cannot be aspirational.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const districts = [];
for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) {
  const doc = parse(readFileSync(join(root, "data/districts", f), "utf8"));
  for (const d of doc.districts) districts.push({ state: doc.state, ...d });
}
const claims = readdirSync(join(root, "facts/claims")).filter(f => f.endsWith(".md"))
  .map(f => readFileSync(join(root, "facts/claims", f), "utf8"));
const worklist = JSON.parse(readFileSync(join(root, "site/data/worklist.json"), "utf8"));

const sourced = districts.filter(d => d.source);
// What counts as open for each task, written as a predicate so the definition is in one place and the
// page cannot drift from it.
const OPEN = {
  "district-policy-scan": {
    count: worklist.unchecked,
    unit: "districts that reported striking a student and whose policy nobody has read",
    where: "/kids/worklist/",
  },
  "contact-capture": {
    count: sourced.filter(d => !(d.contact?.district_email || d.contact?.board_email)).length,
    unit: "districts in the record with no published email, so nothing can be sent to them",
  },
  "date-the-change": {
    count: sourced.filter(d => d.status === "bans" && !(d.policy_revised || d.policy_adopted)).length,
    unit: "districts that prohibit it with no date on the policy, so they cannot be placed on the timeline",
    where: "/kids/timeline/",
  },
  "recover-blocked-source": {
    // An unknown record has no source by definition -- that is what makes it unknown -- so this counts
    // every district somebody searched for and could not read, not only the sourced ones.
    count: districts.filter(d => d.status === "unknown" && d.notes).length,
    unit: "districts left unknown after a real search, most of them behind a vendor wall",
  },
  "verify-claim": {
    count: claims.filter(t => /^status: reported/m.test(t)).length,
    unit: "claims still marked reported rather than verified",
  },
  "bill-watch": { count: null, unit: "states, each one legislative session" },
  "crdc-refresh": { count: null, unit: "federal release years" },
  "decision-maker-dossier": { count: null, unit: "school boards and state education committees" },
  "share-kit": { count: null, unit: "states" },
  "training-review": { count: null, unit: "modules in the replacement curriculum" },
};

const tasks = parse(readFileSync(join(root, "crew/tasks/tasks.yaml"), "utf8")).tasks;
const rows = tasks.map(t => ({
  id: t.id, title: t.title, priority: t.priority ?? null,
  unit: t.unit ?? null, scopes: t.scopes?.length ?? null,
  ...(OPEN[t.id] ?? { count: null, unit: t.unit ?? null }),
})).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || (b.count ?? -1) - (a.count ?? -1));

const unknown = tasks.filter(t => !OPEN[t.id]).map(t => t.id);
if (unknown.length) console.error(`no open-work rule for: ${unknown.join(", ")} -- add one to tools/queue.mjs or the page will show them as unquantified`);

writeFileSync(join(root, "site/data/queue.json"), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), tasks: rows }, null, 1));
const counted = rows.filter(r => r.count !== null);
console.log(`queue: ${rows.length} tasks, ${counted.length} with a live count, ${counted.reduce((a, r) => a + r.count, 0).toLocaleString()} units of work open`);
for (const r of counted) console.log(`  ${String(r.count).padStart(4)}  ${r.id}`);
