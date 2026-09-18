---
name: district-policy-scan
description: Find and record the corporal punishment policy of every public school district in a US state (or a slice of one), with source URL and verbatim quote, in data/districts/<XX>.yaml. Use when asked to "scan districts", "map district policies", or given a state name with this project open.
---

# District policy scan

Argument: a state name or code, optionally a slice ("Texas, districts A-C" or "Texas, NCES ids 4800001-4820000").

## Steps

Use the server's tools rather than reading documents into your own context. A handbook is 200 pages; you need three sentences from it.

1. Load `data/districts/<XX>.yaml`. Entries with a `source` and a `last_verified` inside twelve months are done; skip them. An entry with `status: unknown` and a `legacy_status` is a placeholder from the old map, not a fact: treat it as unscanned and ignore what it says.
2. Get the district list for the state from the federal district file (NCES Common Core of Data), with the NCES id and website for each. Keep only regular and charter districts, and only your slice if you were given one.
3. `resolve_handbook` with the district's website. It returns candidate handbooks and codes of conduct, newest school year first, with the vendor hosting each. Check the school year before you trust one.
4. `fetch_document` on the winner. It downloads and extracts server-side and returns only the passages matching the crew's terms, with page numbers, plus the table of contents. Read the whole document only when the terms return nothing, and then ask for a page range rather than the lot.
5. In Texas, `fetch_tasb_policy` with the district's TASB key reads FO(LOCAL), which is the board policy the handbook refers to, with its update number and issue date. FO(LEGAL) is the statute and is the same for every district, so it never establishes a district's own policy.
6. In Alabama, Georgia and Kentucky, most districts publish board policy through Simbli, and a Simbli page returns nothing to a plain fetch: it is an empty shell that assembles itself in a browser. `fetch_simbli_policy` reads it anyway. Give it the number after `S=` in the district's policy link; with no other argument it returns the whole policy index, so you can see what the district actually has rather than guessing a code. Codes are not consistent between districts — Etowah County calls it 6.17 Corporal Punishment, Blount County buries it in 05.13 Discipline — so match on the title, not on a code you expect. The text is cached against the ViewPolicy URL, so cite that URL as `source` and your quote will verify against what you read.
7. Classify per AGENTS.md and copy the sentence that establishes it, verbatim, from what the tool returned. Record `policy_code` when the manual uses one.
8. `submit_finding`. The server checks your quote against the copy it cached in step 4, so you are verified against the text you actually read. If the document was a scan, or a host blocked the server, pass `source_text`.
9. Anything that stops you: `report_issue`. Check `list_issues` first. Put the record that would not submit in `context` so the work is not lost, and reference the issue id in the finding's notes.
10. Every 25 districts, run the validator and commit, so a crash loses little.

Board policy beats the handbook when you can get it. A handbook is written by staff and reprinted every year; a policy is what the board voted on, and it carries the date they last touched it. `resolve_handbook` now reports any policy system it finds on a district's site, so a district with no handbook PDF is usually not a dead end.

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
