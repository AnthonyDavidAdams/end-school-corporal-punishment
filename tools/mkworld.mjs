import { readFileSync, writeFileSync } from "node:fs";
import { feature } from "topojson-client";
const topo = JSON.parse(readFileSync("/tmp/world.json", "utf8"));
const fc = feature(topo, topo.objects.countries);
const rings = [];
for (const f of fc.features) {
  const gs = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of gs) for (const ring of poly) {
    if (ring.length < 6) continue;
    rings.push(ring.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]));
  }
}
const out = JSON.stringify({ source: "Natural Earth via world-atlas countries-110m (public domain)", rings });
writeFileSync("../site/data/world.json", out);
console.log(`${rings.length} rings, ${(out.length / 1024).toFixed(0)} KB`);
