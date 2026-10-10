---
name: contact-capture
description: For districts already in data/districts/<XX>.yaml, record the contact each district publishes for the public (office email and phone, mailing address, superintendent's published name, board page, how to sign up for public comment) as the record's contact block. Public record only. Use when asked to "capture contacts", "find who to write to", or handed the contact-capture task for a state.
---

# Contact capture

Argument: a state code from the task's scopes (AL, AR, FL, GA, MO, MS, OK, TN, TX), optionally a list of districts.

The output is a `contact` block on each district's record, filed through `submit_finding` as a complete district record. It is what lets anyone write to a board about its own policy.

## What goes in, and what stays out

In: what the district publishes on its own site for the public to use. The general or superintendent's office email, the board or board clerk email, the district office phone and mailing address, the superintendent's name as printed, the board page, and the published rules for speaking at a meeting.

Out: anything personal (a home address, a cell number, a private or social account), any staff member who is not the published point of contact, individual teachers, anything behind a login, and anything from a people-search or aggregator site. If a board lists only individual members' addresses and no board or clerk address, leave `board_email` null and say so in `notes`; members belong to the decision-maker-dossier task.

## Steps

1. `claim_task` with task `contact-capture`, your `agent`, `human`, and the state as scope. Renew before `expires_at`; release when you stop.
2. Read the stored record for each district (`data/districts/<XX>.yaml`, or `get_record` on the `districts` collection). Skip districts whose `contact` already has `contact_page` and an `as_of` inside twelve months.
3. Check `list_pending` for each district task (`district-policy-scan`, `contact-capture`, `date-the-change`, `recover-blocked-source`). A pending finding may hold a newer status, source, quote or dates than the stored record. Carry those fields forward. If it already has a complete contact block from this year, skip the district.
4. Confirm the district's website. Use the website in the stored contact block or the federal directory, and check that the domain, the district name and the mailing address are all in this state. Then confirm that the stored `source` is this district's own document (see Pitfalls). If it is another district's, do not add a contact on top of it. Re-source the record from the district's own policy, or `report_issue` and move on.
5. Find the contact pages: "Contact Us", "Central Office", "Superintendent", "Board of Education", "Board Meetings". For public comment, also search the board's policy index for "public participation" or "public comment"; codes differ by state. Open each page yourself. Use `fetch_document` for a PDF.
6. Fill the block from those pages. Copy each value as printed. For `public_comment`, quote the published rule: the sign-up deadline, the form, and the time limit. If the board page gives only meeting times, write exactly that. Do not infer a rule that is not printed.
7. If the district publishes only a web form and no email address, set `contact_page` to the form's URL, leave the emails null, and write "Publishes only a web contact form" in `notes`. Never guess an address from a naming pattern.
8. Re-open the record's `source` and confirm the `quote` is still on it (`fetch_document` with the quote's key words). If it is gone, the policy changed: re-scan it the way district-policy-scan does, or leave the district for that task.
9. `submit_finding` with task `contact-capture`, the complete record (below), and `skill` set to `contact-capture@0.1`.

## The record

Shape: `crew/schemas/district-finding.schema.json`. It requires `state`, `name`, `status` and `last_verified`, plus `source` and `quote` for any status other than `unknown`. The `contact` block's fields come from `data/schema/district.schema.json`, which allows no other keys.

| Field | What goes in |
|---|---|
| `district_email` | General or superintendent's office email, as published |
| `board_email` | Board or board clerk email, as published |
| `phone` | District office main line |
| `mailing_address` | Central office mailing address |
| `superintendent` | Name exactly as published |
| `board_page` | URL listing members and meeting times |
| `contact_page` | URL the contact details were read from |
| `public_comment` | The published sign-up rule, quoted, or what the page does say |
| `as_of` | Today's date, YYYY-MM-DD |
| `website` | The district's own site |
| `source` | URL of the page the block was read from |
| `contact_source` | Only when a field came from the state education agency's published directory: name it and its date |

Prefer the district's own pages. Use the state agency's directory only for a field the district does not publish, and record it in `contact_source`. Unused fields are null.

Carry forward unchanged: `name` and `nces_id` exactly as stored, plus `county`, `status`, `source`, `quote`, `policy_code`, `policy_adopted`, `policy_revised`, `policy_dates_from`, `parent_control` and `notes`. Add to the notes; do not replace them. Set `last_verified` to today.

## Done means

- Every field is a page the district publishes for the public, and `contact_page` records where it was read.
- Nothing is a personal address, a staff member who is not the published point of contact, or anything behind a login.
- A district that publishes only a web form says so, rather than getting a guessed address.

## Pitfalls

- **A new finding supersedes the pending finding for the same district.** If your record omits a field the pending one had, that field is lost. File complete records. `list_pending` returns at most 500 findings, so on a busy task some may be hidden. If `submit_finding` reports a superseded finding you had not seen, put its id in your notes for the reviewer.
- **Same-named districts in other states** were the most common error found in the record this cycle. Hundreds of records cited another state's district: a Hampton, SC record citing Hampton, AR's handbook, and a Spring Hill, KS record citing Spring Hill College in Alabama. A contact block must not come from that other district's site either. Check the state in the address, the domain, and the policy numbering, which differs by state: Arkansas 4.39, Tennessee 6.314, Texas FO(LOCAL), Mississippi JDA/JDB.
- Use the stored name. A finding filed under a slightly different name creates a second record instead of updating the first.
- Do not file a record with status `unknown` and do not file "found nothing". If the site cannot be read, `report_issue` (check `list_issues` first) and move on.
- A superintendent named in a news story but not on the district's site is not published contact. Leave the field null.

## Before you start

Read `AGENTS.md` at the repository root. Its rules bind this skill: open every source, quote verbatim, date everything, never guess, no student names. When working in the repository, use a branch named `<task>/<scope>-<date>`; never commit to `main`.

## Finishing

1. Through the crew server: `release_lease`, and report the number filed, the districts skipped and why, and the ids of any issues you filed.
2. In the repository instead: run `cd tools && npm i && npm run validate`, commit only the state file you changed, and open a pull request with `gh pr create`, including the agent disclosure line naming this skill and its version.
