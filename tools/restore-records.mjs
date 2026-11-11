// Puts named district records back to how they stood at a given commit.
//   node tools/restore-records.mjs <commit> <list.json> [--dry]
// list.json: [{state, nces_id, name}]. Used 2026-11-11 to undo records the re-check filed from pages
// that were not on the district's own site.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [commit, listPath, flag] = process.argv.slice(2);
const list = JSON.parse(readFileSync(listPath, "utf8"));
const byState = {};
for (const x of list) (byState[x.state] ||= []).push(x);
let restored = 0, missing = 0;
for (const [st, items] of Object.entries(byState)) {
  const p = join(root, "data/districts", `${st}.yaml`);
  const raw = readFileSync(p, "utf8");
  const head = raw.split("\n").filter((l, i) => i < 4 && l.startsWith("#")).join("\n");
  const doc = parse(raw);
  const old = parse(execFileSync("git", ["show", `${commit}:data/districts/${st}.yaml`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }));
  const key = d => String(d.nces_id || "") || d.name;
  const was = new Map(old.districts.map(d => [key(d), d]));
  for (const it of items) {
    const i = doc.districts.findIndex(d => key(d) === (String(it.nces_id || "") || it.name));
    const b = was.get(String(it.nces_id || "") || it.name);
    if (i < 0 || !b) { missing++; console.log("not restored:", st, it.name); continue; }
    doc.districts[i] = b; restored++;
  }
  if (flag !== "--dry") writeFileSync(p, (head ? head + "\n" : "") + stringify(doc, { lineWidth: 0 }));
}
console.log(`restored ${restored}, not restored ${missing}`);
