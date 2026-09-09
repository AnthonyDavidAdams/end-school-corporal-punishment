---
name: district-policy-scan
description: Find and record the corporal punishment policy of every public school district in a US state (or a slice of one), with source URL and verbatim quote, in data/districts/<XX>.yaml. Use when asked to "scan districts", "map district policies", or given a state name with this project open.
---

# District policy scan

Argument: a state name or code, optionally a slice ("Texas, districts A-C" or "Texas, NCES ids 4800001-4820000").

## Steps

1. Load `data/districts/<XX>.yaml`. Existing entries with `source` set and `last_verified` within 12 months are done; skip them.
2. Get the full district list for the state from the NCES Common Core of Data district search (https://nces.ed.gov/ccd/districtsearch/), filtered to regular public districts. Record `nces_id` for each. If the slice is by letter range or id range, keep only those.
3. For each district, find the corporal punishment policy. Search in this order, stopping at the first authoritative hit: BoardDocs, Simbli/eBoard, TASB Policy Online (Texas, policy FO(LOCAL)), the state school boards association policy service, the district's student handbook PDF, the district site search. Query terms: "corporal punishment", "paddling", "physical discipline".
4. Classify per AGENTS.md: `allows`, `consent_required`, `bans`, or `unknown`. Copy the sentence that establishes the status verbatim into `quote`. Record `policy_code` when the manual uses one.
5. Write the entry. Keep the file sorted by district name. For `unknown`, put what you searched in `notes`.
6. Every 25 districts, run the validator and commit, so a crash loses little.

## Quality bar

- A status without a quote is `unknown`.
- A handbook that is silent on corporal punishment is `unknown`, not `bans`, unless state law prohibits it.
- Board minutes announcing a policy change count as a source; cite the minutes URL and date in `notes`.

## Before you start

Read `AGENTS.md` at the repository root. Its rules bind this skill: open every source, quote verbatim, date everything, never guess, no student names. Work on a branch named `<task>/<scope>-<date>`; never commit to `main`.

## Finishing

1. Run `cd tools && npm i && npm run validate` and fix anything it reports.
2. Commit only the files you changed, by name.
3. Open a pull request with `gh pr create`, filling the template: sources, what was searched for every `unknown`, and the agent disclosure line naming this skill and its version.
