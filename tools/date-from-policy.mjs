// Give every prohibiting district the date printed on its policy (TASB "DATE ISSUED", Simbli
// "last revised"), from the classifier's date_issued keyed by source URL. The timeline draws a
// dated prohibition where the district decided it and an undated one where we found it.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bysrc = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/dates-by-source.json", "utf8"));
let total = 0, filled = 0;
for (const f of readdirSync(join(root, "data/districts")).filter((f) => f.endsWith(".yaml"))) {
  const p = join(root, "data/districts", f); const text = readFileSync(p, "utf8"); const doc = parse(text); let ch = false;
  for (const d of doc.districts ?? []) {
    if (d.status !== "bans") continue; total++;
    if (d.policy_revised || d.policy_adopted) continue;
    const dt = bysrc[d.source]; if (!dt) continue;
    d.policy_revised = dt; d.policy_dates_from = "policy"; filled++; ch = true;
  }
  if (ch) writeFileSync(p, text.split("\n").filter((l) => l.startsWith("#")).join("\n") + "\n" + stringify(doc, { lineWidth: 0 }));
}
console.log(`bans ${total}, newly dated ${filled}`);
