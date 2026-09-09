# Task queue

Claim a scope with the "Claim a task" issue template before starting so work is not duplicated. Each task has a skill in `skills/` that runs it end to end in Claude Code (`/escp:<task>`), and a plain description here for any other agent or a person.

| Task | Unit of work | Output | Priority |
|---|---|---|---|
| `district-policy-scan` | One state, or a slice of a large state (Texas has over 1,000 districts) | Entries in `data/districts/<XX>.yaml` with source + quote | **1** |
| `crdc-refresh` | One CRDC release year | `data/crdc/<year>/` state and district CSVs + `facts/` figure updates | **1** |
| `verify-claim` | One claim file | `status: verified` with primary source, or `disputed` with reasons | 2 |
| `bill-watch` | One state, current session | `bills:` entries in `data/states/<XX>.yaml` | 2 |
| `decision-maker-dossier` | One state education committee | `crm/dossiers/<XX>/<body>.yaml` | 3 |
| `training-review` | One module in `training/modules/` | Review issue with citations checked | 3 |
| `share-kit` | One state | Text + image for `share/<XX>/` | 4 |

## Scope of the district scan

Public school districts in the states where corporal punishment remains legal or de facto banned (approximate counts from NCES): Texas ~1,200, Missouri ~520, Oklahoma ~510, Arkansas ~260, Georgia ~180, Mississippi ~140, Alabama ~140, Louisiana ~70, Tennessee ~140, South Carolina ~80, Kentucky ~170, North Carolina ~115, Florida 67, Arizona ~230, Indiana ~290, Kansas ~290, Wyoming 48. Roughly 4,400 districts. As of the first commit, 274 are recorded and 0 are sourced.

A good agent run covers 30 to 60 districts per hour. The whole scan is a few hundred agent-hours: large for one person, small for a crowd.

## Done means

- Validator passes.
- Every non-`unknown` status has `source`, `quote`, `last_verified`.
- PR body lists what was searched for each `unknown`.
