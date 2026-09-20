// Emits one filled SVG path per school district that this project holds a record for, keyed by NCES
// id, so the map can colour the actual district rather than the county it sits in.
//
// Counties were a stand-in and a poor one: district lines do not follow county lines, a county can hold
// several districts with opposite policies, and a city district inside a county district is invisible
// at county resolution. Talladega City and Talladega County are the case this project already got
// wrong once.
//
// Only districts in the record are emitted, which is what keeps the file small: 19,000 districts exist
// and we hold a sourced policy for a few hundred.
//
// Source: US Census Bureau cartographic boundary files, 2024 (public domain). Projected with the same
// Albers USA composite as us-atlas, so the paths line up with the county map already on the page.
//
// Usage: node build-district-shapes.mjs <dir with cb_2024_us_*_500k.shp>
import { writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { open } from "shapefile";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { parse } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = process.argv[2];
if (!dir) { console.error("usage: node build-district-shapes.mjs <dir with the Census shapefiles>"); process.exit(1); }

// Every NCES id we hold a sourced record for. Unified, elementary and secondary district files all use
// the same 7-digit GEOID, so one set covers all three.
const wanted = new Map();
for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) {
  const doc = parse(readFileSync(join(root, "data/districts", f), "utf8"));
  for (const d of doc.districts) if (d.source && d.nces_id) wanted.set(d.nces_id, { state: doc.state, name: d.name });
}

const projection = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const path = geoPath(projection);
// One decimal is about a tenth of a pixel at the size this is drawn, and halves the file.
const round = (d) => d.replace(/-?\d+\.?\d*/g, (s) => String(Math.round(Number(s) * 10) / 10));

const out = {};
const files = readdirSync(dir).filter((f) => /^cb_2024_us_(unsd|elsd|scsd)_500k\.shp$/.test(f));
if (!files.length) { console.error(`no cb_2024_us_{unsd,elsd,scsd}_500k.shp in ${dir}`); process.exit(1); }
for (const f of files) {
  const src = await open(join(dir, f), join(dir, f.replace(/\.shp$/, ".dbf")));
  while (true) {
    const r = await src.read();
    if (r.done) break;
    const p = r.value.properties;
    const id = p.GEOID ?? `${p.STATEFP}${p.UNSDLEA ?? p.ELSDLEA ?? p.SCSDLEA ?? ""}`;
    if (!wanted.has(id) || out[id]) continue;
    const d = round(path(r.value.geometry) || "");
    if (d) out[id] = d;
  }
  console.log(`${f}: ${Object.keys(out).length} of ${wanted.size} matched so far`);
}

const missing = [...wanted].filter(([id]) => !out[id]);
const payload = JSON.stringify({
  source: "US Census Bureau cartographic boundary files, unified/elementary/secondary school districts 2024 (public domain)",
  projection: "d3 geoAlbersUsa().scale(1300).translate([487.5, 305]), the same composite as the county map",
  count: Object.keys(out).length,
  shapes: out,
});
writeFileSync(join(root, "site/data/district-shapes.json"), payload);
console.log(`${Object.keys(out).length} district shapes, ${(payload.length / 1024).toFixed(0)} KB raw, ${(gzipSync(Buffer.from(payload)).length / 1024).toFixed(0)} KB gzipped`);
if (missing.length) {
  console.log(`\nno boundary found for ${missing.length}:`);
  for (const [id, m] of missing.slice(0, 20)) console.log(`  ${m.state} ${m.name} (${id})`);
}
