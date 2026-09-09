---
name: bill-watch
description: Find every bill, rule, or board action on school corporal punishment in one US state's current legislative session and record it in data/states/<XX>.yaml. Use when asked to "watch bills", "check the legislature", or "update the law status" for a state.
---

# Bill watch

Argument: a state name or code.

## Steps

1. Read `data/states/<XX>.yaml`. Note existing `bills` and `statute`.
2. Search the state legislature's site and LegiScan for the current and previous session: "corporal punishment", "paddling", "physical discipline", "student discipline" plus the education code section number from `statute`.
3. For each bill: number, session, sponsor, one-sentence summary, status (`pending`, `passed`, `failed`, `vetoed`, `signed`), official URL. Include bills that would expand or protect corporal punishment, not only bans; mark them in the summary.
4. If a bill has been signed, update `status`, `year_banned`, `statute`, `limits`, `last_verified`, and open an issue `[law] <State> <bill>` so maintainers update the facts and map copy.
5. Check the state department of education for rules or guidance issued in the period, and the state school boards association for model-policy changes.

## Before you start

Read `AGENTS.md` at the repository root. Its rules bind this skill: open every source, quote verbatim, date everything, never guess, no student names. Work on a branch named `<task>/<scope>-<date>`; never commit to `main`.

## Finishing

1. Run `cd tools && npm i && npm run validate` and fix anything it reports.
2. Commit only the files you changed, by name.
3. Open a pull request with `gh pr create`, filling the template: sources, what was searched for every `unknown`, and the agent disclosure line naming this skill and its version.
