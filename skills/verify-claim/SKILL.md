---
name: verify-claim
description: Open the primary source behind a claim in facts/claims/ and upgrade it to verified, correct it, or mark it disputed. Use when asked to "verify a fact", "check this claim", or handed a claim id.
---

# Verify a claim

Argument: a claim id (filename in `facts/claims/` without `.md`), or "next" to take the oldest `reported` claim.

## Steps

1. Read the claim file. Note its `figure`, `as_of`, and every listed source.
2. Open each source with WebFetch. For a CRDC figure, download the actual data file or the official summary table; for a statute, open the legislature's own site; for a study, open the journal page or PubMed entry, not a press summary.
3. Decide:
   - The source says exactly this: set `status: verified`, `last_verified` to today, `verified_by` to `agent:<your name>`, and add the primary source with `primary: true` if missing.
   - The source says something different: correct `claim` and `figure` to what the source says, keep the old wording in the body under "History", set `verified`.
   - Sources conflict or the source is gone: set `status: disputed`, explain in the body, open an issue `[fact] <id>`.
4. If the claim is now stale because a newer data year exists, create a new claim file with the new figure, set the old one to `retired` with `supersedes` pointing the right way.
5. Grep `templates/`, `README.md`, `strategy/`, and `training/` for the old figure and update every occurrence.

## Before you start

Read `AGENTS.md` at the repository root. Its rules bind this skill: open every source, quote verbatim, date everything, never guess, no student names. Work on a branch named `<task>/<scope>-<date>`; never commit to `main`.

## Finishing

1. Run `cd tools && npm i && npm run validate` and fix anything it reports.
2. Commit only the files you changed, by name.
3. Open a pull request with `gh pr create`, filling the template: sources, what was searched for every `unknown`, and the agent disclosure line naming this skill and its version.
