// Take back the "searched" stamp from every district in a night's slice that was never actually searched.
//
// The slice is stamped before the search runs, so that a district is not picked twice. When the search
// then stops part-way (no credit, no network), the districts after the stop were stamped without being
// looked at and would sit out the next 14 days for nothing. A district counts as searched only if the
// finder wrote a row for it without an error.
//
//   node tools/nightly/unstamp.mjs out/nightly/2026-11-10
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const stampFile = "data/handbooks/nightly-searched.json";
if (!dir || !existsSync(join(dir, "slice.json")) || !existsSync(stampFile)) { console.log("unstamp: nothing to do"); process.exit(0); }
const slice = JSON.parse(readFileSync(join(dir, "slice.json"), "utf8"));
const found = existsSync(join(dir, "found.jsonl")) ? readFileSync(join(dir, "found.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const searched = new Set(found.filter((r) => !r.error).map((r) => `${r.state}|${r.district}`));
const seen = JSON.parse(readFileSync(stampFile, "utf8"));
let n = 0;
for (const d of slice) { const k = `${d.state}|${d.name}`; if (!searched.has(k) && seen[k]) { delete seen[k]; n++; } }
if (n) writeFileSync(stampFile, JSON.stringify(seen));
console.log(`unstamp: ${n} of ${slice.length} districts were not searched and go back on the list`);
