// Geographic centre of each state, for anything drawn on a globe rather than on the Albers canvas.
// site/assets/state-centroids.json holds projected x/y, which is the right thing for the flat map and
// useless for a sphere.
//
// Values are the US Census Bureau's centre-of-population points, rounded to a tenth of a degree. A
// tenth is about eleven kilometres, which on a 600-pixel globe is under a pixel.
import { writeFileSync } from "node:fs";
const C = {
  AL: [32.8, -86.8], AK: [63.4, -152.4], AZ: [34.2, -111.7], AR: [34.9, -92.4], CA: [37.2, -119.5],
  CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5], DC: [38.9, -77.0], FL: [28.6, -82.4],
  GA: [32.6, -83.4], HI: [20.3, -156.4], ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3],
  IA: [42.1, -93.5], KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.1, -92.0], ME: [45.4, -69.2],
  MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7],
  MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6],
  NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.5, -79.4], ND: [47.4, -100.5],
  OH: [40.3, -82.8], OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.6],
  SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.8, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7],
  VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.6], WI: [44.6, -89.7],
  WY: [43.0, -107.6],
};
writeFileSync(new URL("../../site/data/state-latlon.json", import.meta.url),
  JSON.stringify(Object.fromEntries(Object.entries(C).map(([k, [lat, lon]]) => [k, { lat, lon }]))));
console.log(`${Object.keys(C).length} state centres written`);
