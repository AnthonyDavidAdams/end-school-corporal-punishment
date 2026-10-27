# County adjacency

`county-adjacency.csv` — every pair of US counties that share a border, by FIPS code, one row per direction, from
the Census Bureau's county adjacency file (https://www2.census.gov/geo/docs/reference/county_adjacency.txt, public
domain). `tools/game/neighbors.py` uses it to find the permitting districts next door to a district that just put a
ban in writing. District to county is `data/nces/lea-geocode-2023-24.csv` (the county of the district office).
