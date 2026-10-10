---
name: date-the-change
description: For a district whose record bans corporal punishment but carries no adoption or revision date, find when its board acted (from the policy's own dates line, board minutes, an agenda, or a dated policy manual) and record policy_adopted, policy_revised and policy_dates_from in data/districts/<XX>.yaml. Use when asked to "date the ban", "find when they stopped", or handed the date-the-change task.
---

# Date the change

Argument: one district ("<District name>, <XX>"), or a state to work through its undated bans.

The output is the date the board adopted or last revised the policy that prohibits corporal punishment, from a document the board itself published. A date turns "they never did" into "they stopped", and only the second is an example another board can be shown.

## Steps

1. `claim_task` with task `date-the-change`, your `agent` and `human`. Renew before `expires_at`; release when you stop.
2. Read the stored record (`data/districts/<XX>.yaml`, or `get_record` on the `districts` collection). Candidates have `status: bans` and null `policy_adopted` and `policy_revised`.
3. Check `list_pending` for each district task (`district-policy-scan`, `contact-capture`, `date-the-change`, `recover-blocked-source`). If a pending finding already carries a date from the policy, skip the district. Otherwise carry its fields forward, the contact block above all.
4. Confirm the stored `source` is this district's own document: the state, domain and address match, and the policy numbering fits the state. If it is another district's, find this district's own policy first. If that changes the status, file the change with the new source and say so in `notes`.
5. Find the date in the board's own documents, in this order:
   - **The policy's dates line.** Read the policy itself, not the handbook. BoardDocs prints Status and Last Revised in the policy header. Simbli's index gives a revision date for each code; use `fetch_simbli_policy`. For TASB, `fetch_tasb_policy` returns the LOCAL section's DATE ISSUED. KASB prints "Approved:" dates, TSBA prints "Issued Date", and NC manuals print "Adopted:" and "Revised:".
   - **Board minutes or an agenda** that record the vote adopting or revising the policy. Search the board's meeting archive for "corporal punishment", the policy code, and "first reading" or "second reading".
   - **A dated policy manual**, where the manual itself prints the date the board adopted it.
6. Re-open the record's `source` and confirm the `quote` still verifies. If the policy you dated is a better source than the stored one, make it the `source` and copy its sentence as the `quote`.
7. `submit_finding` with task `date-the-change`, the complete record (below), and `skill` set to `date-the-change@0.1`.

## The record

Shape: `crew/schemas/district-finding.schema.json`. It requires `state`, `name`, `status` and `last_verified`, plus `source` and `quote` for a non-`unknown` status. The date fields come from `data/schema/district.schema.json`.

- `policy_adopted`: the date the policy was first adopted, as printed (YYYY-MM-DD).
- `policy_revised`: the date it was last revised or reissued, as printed (YYYY-MM-DD). For TASB, use the LOCAL DATE ISSUED.
- `policy_dates_from`: `policy`, meaning you read the dates off the board's document.
- `notes`: the document the dates came from, with its URL and the lines as printed. For minutes, give the meeting date, the agenda item and the vote.

Carry forward unchanged: `name` and `nces_id` exactly as stored, plus `county`, `status`, `source`, `quote`, `policy_code`, `parent_control`, the `contact` block (required in AL, AR, FL, GA, MO, MS, OK, TN and TX, where contact-capture has run) and existing `notes`. Set `last_verified` to today.

If the document gives only a month and year, leave the field null and put the printed date in `notes`. Do not invent a day.

## When nothing is published

Done means asks for a district whose minutes are not online to be "filed as still undated, with what was searched". File that record only when all of these hold:

- you re-opened the source this session and the quote verifies;
- no pending finding for the district carries a date (yours would replace it);
- you carry forward every field, including the contact block;
- `policy_adopted`, `policy_revised` and `policy_dates_from` are null, and `notes` begins "Still undated:" and lists each place searched, with URLs: the policy manual and code, the minutes archive and its date range, and the search terms.

If you cannot meet all four, do not file. Release the district and list it, with what you searched, in your report. Never file status `unknown` under this task.

## Done means

- The date comes from a document the board itself published, not from a news report.
- `policy_dates_from` is `policy`, and the source of the date is recorded in `notes`.
- A district whose minutes are not published online is filed as still undated, with what was searched.

## Pitfalls

- **A policy's dates are for the whole policy**, not for the ban sentence. A policy revised in 2024 may have held the same ban since 1990, and a manual re-adopted wholesale on one day stamps that date on every section. Say which you have: "Policy revised 2024-10-07; the ban sentence predates that revision" or "Whole manual re-adopted 2025-03-25".
- **Simbli's "Original Adopted 01/01/1999"** and similar round dates may be placeholders from a data migration (issue_83dd10e0734c). Do not record one as `policy_adopted` unless another document confirms it. Record the revision date and explain in `notes`.
- **TASB pages show LEGAL and LOCAL dates.** LEGAL is the statute and is the same for every district. Use the LOCAL DATE ISSUED, and only as `policy_revised`: it is the issue stamp of the current version, not the day the ban began.
- **South Carolina policies on BoardPolicyOnline print "Issued"**, which is the state association's model issue stamp, not a board action. Use the "Adopted" and "Revised" dates.
- **News reports are leads, not sources.** A story about a board vote tells you which minutes to look for. If those minutes are not online, the district stays undated.
- **Same-named districts in other states** account for many wrong records. A date from another district's policy is worse than no date, because it is printed on a public page saying this board acted.
- **A new finding supersedes the pending finding for the same district.** File complete records. If `submit_finding` reports superseding a finding you had not seen, put its id in your notes.

## Before you start

Read `AGENTS.md` at the repository root. Its rules bind this skill: open every source, quote verbatim, date everything, never guess, no student names. When working in the repository, use a branch named `<task>/<scope>-<date>`; never commit to `main`.

## Finishing

1. Through the crew server: `release_lease`, and report each district dated, each filed as still undated, and each skipped, with the reason.
2. In the repository instead: run `cd tools && npm i && npm run validate`, commit only the state file you changed, and open a pull request with `gh pr create`, including the agent disclosure line naming this skill and its version.
