# The engine underneath this repository

This repository is two things layered together: an issue (corporal punishment in US schools) and an engine for moving a public issue with people and agents working in the open. The engine is meant to be lifted out and pointed at the next issue once this one has proved it. This file marks which is which so the seam stays clean.

## Layers

| Layer | Issue-agnostic (engine) | Issue-specific (this campaign) |
|---|---|---|
| Truth | `data/schema/claim.schema.json`, `facts/README.md` conventions, `verify-claim` skill, validator | `facts/claims/*.md` |
| Map of the problem | State and district schemas, `build-site-data.mjs`, public-domain map, `site/` | `data/states/`, `data/districts/`, `data/crdc/` |
| Decision-makers | `crm/README.md` model, dossier schema, `decision-maker-dossier` skill, matching rule, `crm/SPEC.md` | `crm/dossiers/` |
| Persuasion | `strategy/playbooks/persuasion.md` (the evidence on what moves officials), message structure | value frames for this issue, case studies, opposition responses |
| Work | `tasks/README.md` format, issue templates, PR template, agent contract in `AGENTS.md`, plugin layout | the specific tasks and their scopes |
| Replacement | The principle that every prohibition ships with a free replacement | `training/` |
| Distribution | `share-kit` skill, share folder layout | per-state kits |
| Funding | `FUNDING.md` ledger | what this campaign spends on |

## What the engine does and does not automate

Agents do the reading, counting, verifying, mapping, drafting, and bookkeeping. People do the persuading, under their own names, to the officials who represent them. That split is not a hedge; it is what the persuasion evidence says works, and it is the line that keeps an influence engine from becoming the thing it is fighting. A future issue pointed at this engine inherits `CODE_OF_CONDUCT.md` rules 2 through 4 and `crm/README.md` rules 1 through 3 unchanged.

## What a second issue needs

1. A values statement (one page) that the campaign's asks must be consistent with.
2. Its claims registry, seeded and verified.
3. Its map: the units where the decision is made (districts, counties, hospitals, employers) with a status schema.
4. Its decision-maker bodies.
5. Its replacement: the answer to "then what instead."
6. Its task list.

Everything else is already here. When the second issue arrives, the engine files move to a template repository and this one depends on it.
