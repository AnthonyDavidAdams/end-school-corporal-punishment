# Map builders

Both read public-domain US Census boundaries and write into `site/`. Neither runs as part of the
normal site build: the inputs are large and change once a year, so the outputs are committed.

## `build-map.mjs` — the national county map

    npm install && npm run build

Writes `site/assets/us-map.svg`, `us-states.svg` and `state-centroids.json` from the `us-atlas`
package, which ships Census boundaries pre-projected into an Albers USA composite on a 975x610
canvas.

## `build-districts.mjs` — school district borders, per state

Corporal punishment policy is set by school districts, and district lines do not follow county lines.
This draws the unit the argument is actually about.

    curl -o /tmp/sd/unsd.zip https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_unsd_500k.zip
    unzip -d /tmp/sd /tmp/sd/unsd.zip
    npm run build-districts

Writes `site/data/districts/districts-<XX>.json`, one per state, each a single SVG path of that
state's internal district borders. A state page fetches only its own, and only when the lines are
switched on.

Two things keep the files small enough to serve. Adjacent districts share every internal border, so
building a topology first stores each border once rather than twice. And the borders are simplified
(Visvalingam, 3e-5 square degrees), which is invisible at the size a state map is drawn and cuts the
result to roughly a quarter. Texas is the worst case at 1,017 districts and about 300 KB, 84 KB over
the wire.

The projection matches `build-map.mjs` exactly — `geoAlbersUsa().scale(1300).translate([487.5, 305])`
— so the district paths line up with the county paths already on the page. If the national map is
ever rebuilt at a different scale, these must be rebuilt too.

Charter districts have no boundary and so do not appear: Texas draws 1,017 of its 1,219 districts.

Source: US Census Bureau cartographic boundary files, unified school districts (public domain).
