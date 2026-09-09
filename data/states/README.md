# States

One file per state and DC, validated against `../schema/state.schema.json`.

| status | meaning | count (2026-09-09) |
|---|---|---|
| `banned` | prohibited in public schools by statute or rule | 34 (33 states + DC) |
| `partial` | permitted by statute, but every district prohibits it by policy | 2 (Kentucky, North Carolina) |
| `legal` | permitted by statute | 15 |

Counts of "states that allow it" vary by source because six states have no statute either way (Connecticut, Indiana, Kansas, New Hampshire, South Dakota, Maine) and are classified differently. This project treats Indiana and Kansas as `legal` (district-level decisions, small reported use) and Connecticut, New Hampshire, South Dakota and Maine as `banned` (no use, treated as prohibited in practice); see each file's notes. The Cardona letter (2023) counted 23 states that allow or do not prohibit; NPR's 2026 tracker counted 15 that allow. `facts/claims/law-states-permitting-count.md` explains.

Five states also prohibit it in private schools: New Jersey, Iowa, Maryland, New York, Illinois.

Files with `last_verified: null` were ported from the old map and have not been checked against a statute; the `bill-watch` task verifies them. As of the first research pass, verified: CO, FL, ID, IL, KY, LA, MD, MS, NC, NM, NY, OK, SC, TN, TX, WY.
