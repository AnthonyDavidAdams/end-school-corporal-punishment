// Fill in the county of every district record that has an NCES id but no county, from the federal
// geocode file. The county map colours by county, so a record without one is invisible on it: on
// 2026-09-25, 1,276 of 1,610 records had no county and the Texas map showed 8 coloured counties for
// 1,055 sourced districts. A county already on a record is left alone -- it may have been checked
// by a person -- and the geocode county is recorded on `county_source` so it is clear which is which.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const geo = new Map();
for (const line of readFileSync(join(root, "data/nces/lea-geocode-2023-24.csv"), "utf8").split("\n").slice(1)) {
  const [id, , county] = line.split(",");
  if (id && county) geo.set(id, county.replace(/\s+County$/i, "").trim());
}
let filled = 0, missing = 0;
for (const f of readdirSync(join(root, "data/districts")).filter((f) => f.endsWith(".yaml"))) {
  const p = join(root, "data/districts", f);
  const text = readFileSync(p, "utf8");
  const doc = parse(text);
  let changed = false;
  for (const d of doc.districts ?? []) {
    if (d.county || !d.nces_id) continue;
    const c = geo.get(String(d.nces_id));
    if (!c) { missing++; continue; }
    d.county = c; d.county_source = "nces_edge_geocode_2023_24"; filled++; changed = true;
  }
  if (changed) writeFileSync(p, text.split("\n").filter((l) => l.startsWith("#")).join("\n") + "\n" + stringify(doc, { lineWidth: 0 }));
}
console.log(`filled ${filled} counties from the geocode file; ${missing} ids not in it`);
