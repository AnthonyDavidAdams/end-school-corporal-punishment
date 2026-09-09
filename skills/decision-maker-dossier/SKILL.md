---
name: decision-maker-dossier
description: Build a sourced, public-record profile of the people who decide corporal punishment policy in one place (a school board, or a state legislature's education committees), with their stated values, public statements, votes, and public affiliations, in crm/dossiers/<XX>/<body>.yaml. Use when asked for a "dossier", "who is on the board", "who decides this", or "who to persuade" in a district or state.
---

# Decision-maker dossier

Argument: a state (for the legislature's education committees) or "<District name>, <State>" (for its school board).

## What goes in, and what stays out

In: everything a member has put on the public record. Official biography, campaign website, statements at public meetings (minutes, video), recorded votes, sponsorships, op-eds, on-the-record quotes in established outlets, public professional affiliations they list themselves (church, employer, civic clubs, alma mater, military service).

Out: private or friends-only social media, family members, home address, anything about children, health, finances, or relationships, anything inferred rather than stated. If you cannot cite a URL a member would expect the public to read, leave it out. Read CODE_OF_CONDUCT.md before starting.

## Steps

1. List the members from the official body's page: name, seat or district, term end, role, official page URL, published contact (official email and phone only).
2. For each member, gather in this order: official bio, campaign site, board or committee minutes and video (search "corporal punishment", "discipline", "paddling"), recorded votes, sponsorships, local press quotes. Record every item with URL and date.
3. Fill the `values` field with the member's own words about what they care about, quoted, with source: "safe schools", "parental rights", "local control", "our teachers", "fiscal responsibility", "faith". These drive message framing in `crm/README.md`; they are quotes, not inferences.
4. Fill `public_affiliations` only from what the member states publicly, with the URL. This is used to match real constituents who share the affiliation and want to speak for themselves.
5. Record `position_on_cp` as `supports_ban`, `opposes_ban`, `open`, or `unknown`, each with the evidence line that justifies it. `unknown` is the honest default.
6. Write `crm/dossiers/<XX>/<body-slug>.yaml` following `crm/README.md`. Summarize in the PR: likely allies, likely opponents, members with no recorded position, and the decisive vote count.

## Before you start

Read `AGENTS.md`. Work on a branch `dossier/<scope>-<date>`.

## Finishing

1. `cd tools && npm run validate`.
2. Commit only the files you changed, by name.
3. `gh pr create` with the template filled, including the agent disclosure.
