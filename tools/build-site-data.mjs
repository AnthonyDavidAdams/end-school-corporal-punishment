// Compiles data/states/*.yaml and data/districts/*.yaml into site/data/*.json for the static map.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const states = {}, districts = {};
for (const f of readdirSync(join(root, "data/states")).filter(f => f.endsWith(".yaml"))) { const d = parse(readFileSync(join(root, "data/states", f), "utf8")); states[d.code] = d; }
for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) { const d = parse(readFileSync(join(root, "data/districts", f), "utf8")); districts[d.state] = d.districts; }
mkdirSync(join(root, "site/data"), { recursive: true });
writeFileSync(join(root, "site/data/states.json"), JSON.stringify(states, null, 1));
writeFileSync(join(root, "site/data/districts.json"), JSON.stringify(districts, null, 1));
// facts/claims/*.md -> claims.json: frontmatter fields plus the markdown body after the closing ---
const claims = [];
for (const f of readdirSync(join(root, "facts/claims")).filter(f => f.endsWith(".md")).sort()) {
  const text = readFileSync(join(root, "facts/claims", f), "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) { console.warn(`skipping ${f}: no frontmatter`); continue; }
  claims.push({ ...parse(m[1]), body: m[2].trim() });
}
writeFileSync(join(root, "site/data/claims.json"), JSON.stringify(claims, null, 1));
const counts = Object.values(states).reduce((a, s) => (a[s.status] = (a[s.status] || 0) + 1, a), {});
writeFileSync(join(root, "site/data/summary.json"), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), states: counts, districts_recorded: Object.values(districts).flat().length, districts_sourced: Object.values(districts).flat().filter(d => d.source).length }, null, 1));
console.log("site/data written", counts, `${claims.length} claims`);
