# Facts

One claim per file in `claims/`, each publishable as a single sentence, each with sources and a verification status. This is the only place in the project a number is allowed to live. Templates, the README, the site, and the training all quote from here, and the `verify-claim` task keeps them current.

## Status meanings

| status | meaning | may be published? |
|---|---|---|
| `verified` | a maintainer or agent opened the primary source and the claim matches it, on `last_verified` | yes |
| `reported` | only a secondary source has been checked | only with "according to <secondary source>" |
| `disputed` | sources conflict or the source is gone | no |
| `retired` | superseded by a newer claim (see `supersedes`) | no |

## File format

```markdown
---
id: crdc-national-total-2021-22
claim: "In the 2021-22 school year, N students received corporal punishment in US public schools."
status: verified
figure: N
as_of: "2021-22"
sources:
  - url: https://civilrightsdata.ed.gov/...
    title: "..."
    publisher: US Department of Education, Office for Civil Rights
    date: 2024-01-01
    primary: true
tags: [crdc, national]
last_verified: 2026-09-09
verified_by: "agent:claude"
---

Plain-language note on how to use the number, what it counts, and what it does not.

## History
- 2026-09-09: created from the CRDC 2021-22 release.
```

## Rules

- The claim sentence names the data year. "In 2021-22" beats "recently".
- Ratios name both sides: "Black students were 15 percent of enrollment and 37 percent of students receiving corporal punishment."
- When a newer data year arrives, create a new claim and retire the old one; never edit a figure in place.
- The `id` is the filename. Prefix by source family: `crdc-`, `law-`, `study-`, `intl-`, `org-`, `persuasion-`, `campaign-`.
