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
| `record-completion` | One district whose record is `silent` or `unknown` | The board policy manual's sentence, policy code and URL in `data/districts/<XX>.yaml` | **1** |
| `neighbor-ask-research` | One permitting district next to one that moved to a ban | A `contacts` record: superintendent and office email, board members, next meeting date, the neighbor that banned, each with its source URL | 2 |

## Generated tasks

The last two tasks are not scoped by hand. The crew server computes their units from the record when it starts (`crew/units.mjs`), and `claim_task` hands them out one district at a time:

- **`record-completion`**: every district in `data/districts/*.yaml` whose status is `silent` (its handbook and the other documents found were read in full and carry no rule) or `unknown` (nothing readable was found). About 713 districts. The ask is the board policy manual, not the handbook: the sentence, verbatim, with the policy code and the URL of the policy page. Order: the permitting states in the order of `data/game/score.json` `permitting_states_by_exposure`, one district from each in turn, largest enrollment first; states that ban by law come after. A manual that is online and has no corporal punishment policy is submitted as `silent` with the manual's URL as `source`; no manual found online is `unknown` with what was searched. Findings go through `submit_finding` against `crew/schemas/district-finding.schema.json`, the same as the scan.
- **`neighbor-ask-research`**: every district in `data/game/next-targets.json` `ranked`: a district that permits corporal punishment on paper in the same or an adjacent county as one that moved to a ban (279 as of the last run of `tools/game/neighbors.py`). The unit carries the banning neighbors the game computed (`anchors`; when a target has none the server names the largest banning district in the same county from the record), the superintendent and office email already on file, and the last move the campaign made. The ask is to collect from the district's own pages, each with its URL: the current superintendent's name and the public office email, every board member's name and seat, the next regular board meeting date, and the neighboring district that already banned. It is submitted as one record of kind `contacts` (`crew/schemas/contacts-finding.schema.json`, collection `contacts`). Nothing is sent to anyone by this task; a person reads every finding before any of it is used.

`claim_task` returns the unit inline; `get_worklist` with the scope (the district's name and state, e.g. `Hall County Schools, GA`) returns the same. The unit counts on the contribute page come from `tools/queue.mjs`.

## Scope of the district scan

Public school districts in the states where corporal punishment remains legal or de facto banned (approximate counts from NCES): Texas ~1,200, Missouri ~520, Oklahoma ~510, Arkansas ~260, Georgia ~180, Mississippi ~140, Alabama ~140, Louisiana ~70, Tennessee ~140, South Carolina ~80, Kentucky ~170, North Carolina ~115, Florida 67, Arizona ~230, Indiana ~290, Kansas ~290, Wyoming 48. Roughly 4,400 districts. As of the first commit, 274 are recorded and 0 are sourced.

A good agent run covers 30 to 60 districts per hour. The whole scan is a few hundred agent-hours: large for one person, small for a crowd.

## Done means

- Validator passes.
- Every non-`unknown` status has `source`, `quote`, `last_verified`.
- PR body lists what was searched for each `unknown`.
