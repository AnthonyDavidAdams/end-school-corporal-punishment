---
name: crdc-refresh
description: Download a US Department of Education Civil Rights Data Collection release and regenerate the corporal punishment extracts in data/crdc/ plus the headline figures in facts/. Use when a new CRDC year is released or asked to "refresh CRDC", "update the federal numbers".
---

# CRDC refresh

Argument: a CRDC school year, e.g. `2021-22`, or "latest".

## Steps

1. Read `data/crdc/README.md` for the file layout and the column names used in previous releases (they change between releases).
2. Find the release on https://civilrightsdata.ed.gov/ (data download) and download the school-level file. Do not use third-party mirrors.
3. Run or adapt `tools/crdc/extract.mjs` to produce: national totals of students receiving corporal punishment by sex, race, IDEA and 504 status; a per-state table; a per-district table with NCES LEA id; and the count of schools and districts reporting any use.
4. Write CSVs to `data/crdc/<year>/` and a `SOURCE.md` naming the exact file, download date, and SHA-256.
5. Update or create claim files in `facts/claims/` for the national total, the state ranking, and the disparity ratios, with `as_of` set to the year and the CRDC URL as the primary source. Retire superseded claims.
6. Join district totals into `data/districts/<XX>.yaml` as `crdc_students_latest` where the NCES id matches.

## Before you start

Read `AGENTS.md` at the repository root. Its rules bind this skill: open every source, quote verbatim, date everything, never guess, no student names. Work on a branch named `<task>/<scope>-<date>`; never commit to `main`.

## Finishing

1. Run `cd tools && npm i && npm run validate` and fix anything it reports.
2. Commit only the files you changed, by name.
3. Open a pull request with `gh pr create`, filling the template: sources, what was searched for every `unknown`, and the agent disclosure line naming this skill and its version.
