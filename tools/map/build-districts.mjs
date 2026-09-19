// Build the school-district border mesh for each state, as one SVG path per state.
//
// The county map on a state page draws counties, but corporal punishment policy is set by school
// districts, and district lines do not follow county lines. Drawing them makes the actual unit of
// the argument visible.
//
// Two things keep this affordable. Adjacent districts share every internal border, so a topology
// stores each border once instead of twice — half the data before anything else. And the borders are
// simplified: at the size a state map is drawn, the difference is invisible and the file is a quarter
// the size. Texas, the worst case with 1,017 districts, comes to about 300 KB, 84 KB over the wire.
//
// Source: US Census Bureau cartographic boundary file, unified school districts, 2024 (public
// domain). Projected with the same Albers USA composite as us-atlas, so the paths line up exactly
// with the county map already on the page.
//
// Usage: node build-districts.mjs <shp> <dbf> <outdir>

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { open } from "shapefile";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import { mesh } from "topojson-client";

const [shp, dbf, outDir] = process.argv.slice(2);
const SIMPLIFY = 3e-5;   // visvalingam area, square degrees; tuned by eye at state-map scale
const FIPS = {"01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY"};

const projection = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const path = geoPath(projection);
const round = (d) => d.replace(/-?\d+\.?\d*/g, (s) => String(Math.round(Number(s) * 10) / 10));

const byState = {};
const src = await open(shp, dbf);
while (true) {
  const r = await src.read();
  if (r.done) break;
  const st = FIPS[r.value.properties.STATEFP];
  if (!st) continue;
  (byState[st] ||= []).push({ type: "Feature", properties: {}, geometry: r.value.geometry });
}

mkdirSync(outDir, { recursive: true });
const index = {};
let totalRaw = 0, totalGz = 0;
for (const [st, feats] of Object.entries(byState).sort()) {
  const topo = topology({ d: { type: "FeatureCollection", features: feats } }, 1e5);
  const s = simplify(presimplify(topo), SIMPLIFY);
  // Internal borders only: the state outline is already on the page.
  const d = round(path(mesh(s, s.objects.d, (a, b) => a !== b)) || "");
  if (!d) continue;
  const payload = JSON.stringify({ state: st, districts: feats.length, source: "US Census Bureau cartographic boundary file, unified school districts 2024 (public domain)", d });
  writeFileSync(join(outDir, `districts-${st}.json`), payload);
  const gz = gzipSync(Buffer.from(payload)).length;
  totalRaw += payload.length; totalGz += gz;
  index[st] = { districts: feats.length, bytes: payload.length };
}
writeFileSync(join(outDir, "districts-index.json"), JSON.stringify(index));
console.log(`${Object.keys(index).length} states written to ${outDir}`);
console.log(`  total ${(totalRaw / 1048576).toFixed(1)} MB raw, ${(totalGz / 1048576).toFixed(1)} MB gzipped`);
const worst = Object.entries(index).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 4);
for (const [st, v] of worst) console.log(`  largest: ${st} ${v.districts} districts, ${(v.bytes / 1024).toFixed(0)} KB`);
