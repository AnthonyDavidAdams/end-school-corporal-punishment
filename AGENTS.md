# Instructions for AI agents working in this repository

You are contributing to a public dataset that legislators, journalists, and school boards will rely on to end corporal punishment in US schools. An error here can be quoted in a hearing. Read this whole file before doing anything.

## The contract

1. **Open the source.** Never record a status, figure, or quote you have not read on the source page yourself in this run. Training-data memory is not a source.
2. **Primary sources first.** Board policy manuals, student handbooks, statutes, court opinions, CRDC data files, and peer-reviewed papers. News reports are secondary: use them to find primary sources, and cite them only when no primary source exists, marked `reported`.
3. **Quote verbatim.** For a district status, copy the exact sentence that establishes it into `quote`. If you cannot find such a sentence, the status is `unknown`.
4. **Date everything.** `last_verified` is today's date in ISO format. `as_of` is the data year the figure describes.
5. **Never guess, never round up.** If a figure cannot be verified, leave it null and say so in the PR body.
6. **No student names or identifying details**, even when a news article prints them.
7. **One scope per PR.** One state's districts, one claim cluster, one module.
8. **Disclose yourself** in the PR template: agent name, skill or prompt used, who ran you.
9. **Do not touch** `facts/claims/*.md` with `status: retired`, or anything under `strategy/targets/` without a maintainer issue.
10. **Run `cd tools && npm run validate`** before opening the PR. A failing validator is a failed task.

## Repository layout

| Path | What it holds | Schema |
|---|---|---|
| `facts/claims/` | One publishable claim per file, with sources and verification status | `data/schema/claim.schema.json` |
| `data/states/` | Legal status per state, statute, limits, bills | `data/schema/state.schema.json` |
| `data/districts/` | Policy status per district, per state file | `data/schema/district.schema.json` |
| `data/crdc/` | Processed federal Civil Rights Data Collection extracts | `data/crdc/README.md` |
| `strategy/` | Theory of change, playbooks, case studies, opposition arguments | prose |
| `templates/` | Bills, policies, letters, testimony, records requests | prose |
| `training/` | The open replacement curriculum for schools | prose |
| `skills/` | Skill files that run the tasks below | `SKILL.md` per skill |
| `tasks/` | The open task queue for agents and people | `tasks/README.md` |
| `site/` | Static map built from `data/` | HTML + JS |

## Tasks you can take

See `tasks/README.md` for the queue. In short:

- `district-policy-scan`: for a state, find every public school district, locate its corporal punishment policy, record status + source + quote.
- `verify-claim`: open the primary source for a `reported` claim and upgrade or dispute it.
- `bill-watch`: find every corporal punishment bill in a state's current session and update `data/states/<XX>.yaml`.
- `crdc-refresh`: pull the newest CRDC release and regenerate `data/crdc/`.
- `decision-maker-dossier`: for a state's education committee, record each member's public position and votes on corporal punishment, with sources.
- `training-review`: review a training module against the evidence in `facts/` and `training/evidence.md`.

## How to find district policies

Most districts publish board policy through one of a few vendors. Search these first:

- BoardDocs (`go.boarddocs.com/<state>/<district>/Board.nsf/Public`): search "corporal punishment"
- Simbli / eBoard (`simbli.eboardsolutions.com`)
- TASB Policy Online (Texas): policy `FO(LOCAL)` and `FO(LEGAL)`, search "corporal punishment"
- MSBA / ASBA / other state school boards association policy services
- The student handbook PDF on the district site, section "Discipline" or "Code of Conduct"
- District website search for "corporal punishment", "paddling", "physical discipline"

The status rules:

- `allows`: the policy authorizes corporal punishment (even with conditions such as parental notice or an opt-out form).
- `consent_required`: corporal punishment may only be administered with written parental permission obtained in advance (opt-in). Florida districts after 2025 fall here if they permit it at all.
- `bans`: the policy prohibits corporal punishment, or the district is in a state where it is prohibited by law.
- `unknown`: you could not find a policy. Say what you searched in `notes`.

## Output format for a district entry

```yaml
  - name: "Rankin County School District"
    county: "Rankin"
    nces_id: "2803720"
    status: allows
    source: "https://example.boarddocs.com/.../policy-JDA"
    quote: "Corporal punishment may be administered by the principal or the principal's designee in the presence of another certified employee."
    policy_code: "JDA"
    last_verified: 2026-09-09
```

NCES district IDs come from the NCES Common Core of Data district search (`nces.ed.gov/ccd/districtsearch/`). Include them; they let us join to CRDC counts.

## When sources disagree

Record both in `notes`, set the status to the more recent official document, and open an issue titled `[conflict] <State> <District>`. Do not silently pick one.
