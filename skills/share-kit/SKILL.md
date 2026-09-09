---
name: share-kit
description: Produce the ready-to-post share text and a state map image for one state under share/<XX>/, using only verified facts from facts/ and data/. Use when asked to "make the share kit", "social posts for <state>", or "something to share".
---

# Share kit

Argument: a state name or code.

## Steps

1. Read `data/states/<XX>.yaml`, the state's rows in the latest `data/crdc/` tables, and every claim in `facts/claims/` with `status: verified`. Use nothing else as a fact.
2. Write `share/<XX>/posts.md` with: one 280-character post, one 3-sentence post for LinkedIn or Facebook, one parent-to-parent text message, and one line for a school-board public comment. Each names the state, one number with its data year, and the link to the state page on the map. No emoji. No pet names. Do not address the reader as "you guys" or similar.
3. Generate `share/<XX>/map.svg` by taking `site/assets/us-states.svg`, coloring the state and applying the legend colors from `site/map.js`, and adding a one-line caption with the figure and source year.
4. Add the state to `share/README.md`.

## Before you start

Read `AGENTS.md` at the repository root. Its rules bind this skill: open every source, quote verbatim, date everything, never guess, no student names. Work on a branch named `<task>/<scope>-<date>`; never commit to `main`.

## Finishing

1. Run `cd tools && npm i && npm run validate` and fix anything it reports.
2. Commit only the files you changed, by name.
3. Open a pull request with `gh pr create`, filling the template: sources, what was searched for every `unknown`, and the agent disclosure line naming this skill and its version.
