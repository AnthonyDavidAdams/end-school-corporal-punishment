# District counts

`lea-counts-2023-24.csv` — how many school districts each state has, so the site can say how much
work is left without anyone having to guess at it.

Counted from the US Department of Education's Common Core of Data, Local Education Agency Universe
Survey, school year 2023-24, the most recent release. Included are `LEA_TYPE` 1 (regular local school
district) and 7 (independent charter district): those are the agencies with a board that sets a
corporal punishment policy. Excluded are supervisory unions, service agencies, state-operated and
federally-operated agencies, which do not.

Source: https://nces.ed.gov/ccd/files.asp (public domain). Regenerate when a new year is released.

# District locations

`lea-geocode-2023-24.csv` — the county (name and FIPS) and the geocoded latitude/longitude of each
district's administrative office, from the NCES EDGE Geocode file for public LEAs, school year 2023-24
(https://nces.ed.gov/programs/edge/Geographic/SchoolLocations, public domain). This is what puts a
district on the county map when the record itself does not say which county it is in. It is the
county of the office, not every county the district serves; a district that straddles a line is
drawn in the one where its office sits. Regenerate with `tools/fill-county.mjs` when a new year is released.
