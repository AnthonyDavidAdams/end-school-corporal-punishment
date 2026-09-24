# Can a calibrated decision model replace the refuter panel?

**Measured 2026-09-24. Yes, for 95% of findings, at 1/10,000th of the cost.**

The adversarial panel — three frontier agents per finding, each told to refute it — is the largest
single cost in this project. A scan run on 2026-09-23 spent 6.18 million tokens to read 26 districts,
237,000 per district, and ended by hitting the account's monthly limit. Most of that was three models
agreeing with each other about boilerplate.

The panel answers one question: *does this quote establish this status?* That is a classification with
a confidence, not a piece of writing, so it does not need a model that writes.

## What was measured

Every district in `data/districts/` with a human-reviewed status and a verbatim quote: **311 records**
(235 allows, 51 bans, 25 consent_required). Each was sent to `typesafe/jev-1.13` through OpenRouter's
Decisions API as a single `choice` question over the three statuses, with the same opt-in versus
opt-out distinction the scanning contract uses. No other context: the district name and the quote.

## Result

| | |
|---|---|
| Agreement with human review | **309 / 311 = 99.4%** |
| Total cost | **$0.0066** |
| Per record | $0.0000212 |

The calibration is the finding, not the headline accuracy:

| Confidence | Records | Agreement |
|---|---|---|
| ≥ 0.99 | 295 | **100.0%** |
| 0.90–0.99 | 10 | 100.0% |
| 0.70–0.90 | 4 | 50.0% |
| < 0.70 | 2 | 100.0% |

Both disagreements fell in the 0.70–0.90 band, at 0.72 and 0.76. It was uncertain exactly where it was
wrong. And the same band contains Enterprise City, the district where two careful frontier refuters
reached opposite verdicts, and Paris TN, one of two findings rejected in review that day for a quote
that did not establish its status. The model is unsure where the humans were unsure.

Reading both disagreements, the quote is the problem in each case rather than the classification.
Rivercrest's quote ("a student whose parent has not given consent... may instead receive an alternative
discipline") does not settle opt-in versus opt-out on its own. Liberty County's is self-contradictory as
written: "Parents may opt out to permit corporal punishment... by signing and returning the consent
form." A finding whose quote cannot be classified confidently is a finding whose quote needs replacing.

## What this justifies

Route on confidence. At a 0.99 threshold, 295 of 311 records auto-confirm with no errors and 16 go to a
frontier agent. That replaces three frontier agents per finding with two thousandths of a cent, and
concentrates expensive judgment on the 5% where it changes the answer.

## What it does not do

Jev returns typed decisions, never strings. It cannot extract a verbatim quote, and this project's
contract requires one, so quote extraction stays deterministic or agentic. It also does nothing about
the two things actually blocking the queue: finding each district's handbook, and TASB serving Texas
policy text only to a rendered browser. Verification was never the bottleneck on coverage — it was the
bottleneck on cost.

## Reproduce

```sh
node -e '…'                      # regenerate /tmp/gold.json from data/districts/
python3 research/jev/validate.py # needs an OpenRouter key
```

`results.json` holds every record with the human status, the model's choice and its confidence.
