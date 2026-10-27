# The Safe Schools game

The project is run as a game an AI learns to win by experiment. The objective is a written ban on corporal punishment
covering every child in the country. This folder is the engine: the score, the ledger, the experiments, the next
targets, and the weekly review. Everything is a data file or a script, so any agent (a Ground Crew agent included)
can play from it, and every number can be recomputed from the record.

## The loop

1. **Score.** `python3 tools/game/score.py` reads the record (`data/districts/*.yaml`) and the state laws and counts
   children: covered by a written ban (state law, or the district's own policy), exposed under a permitting policy,
   unmapped (documents silent, or not yet read), and the nearest wins (827 districts that permit on paper and reported
   zero use). Enrollment is the federal 2023-24 count (`data/nces/lea-enrollment-2023-24.csv`). Writes
   `data/game/score.json` and appends a line to `data/game/score-history.jsonl`, so the curve is visible over time.
2. **Move.** A move is anything we do to one district: the first ask, a records request, a follow-up, a reply, the
   alignment invitation, a certificate, a board-member note, a media pitch. The outreach pipeline
   (`tools/outreach/run.py`) records every message it sends in `data/game/moves.jsonl` with the experiment and variant
   it was. Other agents call `ledger.record_move(request_dict, kind=..., variant=..., channel=...)` for moves made
   by other means.
3. **Outcome.** What happened after: a reply, a document received, a status recorded, a certificate, a policy flip,
   a board agenda item, a tagged-link click. `data/game/outcomes.jsonl`, one line each, dated.
   `ledger.record_outcome(district, kind, at, detail)`. `python3 tools/game/ledger.py --backfill` rebuilds both
   ledgers from the outreach file, the victories and corrections logs and the click log without losing lines
   recorded live (merge by id).
4. **Learn.** `data/game/experiments.yaml` defines the variants per move kind. `tools/game/assign.py` deals each
   district a variant deterministically (hash of district id and experiment id, balanced within each state and
   enrollment band, frozen in `data/game/assignments.json`). `python3 tools/game/report.py` prints, per variant,
   the reply rate at 7 days and the document-or-status-flip rate at 14 and 30 days, with counts, and writes
   `data/game/report.md`. `python3 tools/game/neighbors.py` lists, for every district that moved to a ban, the
   permitting districts in the same and adjacent counties, ranked by enrollment: `data/game/next-targets.json`.
5. **Review.** `python3 tools/game/review.py` writes `out/game/review-<date>.md`: scoreboard, experiment table,
   next ten targets, and three proposed new variants written by the model through `claude -p`. Runs on Sundays from
   the recap job. Proposals are proposals; nothing is queued or sent from a review.

## Rules of play

- Honest persuasion only. A variant may change the subject, the opener, the size of the ask, or attachment versus
  link. It may not invent a fact, imply a deadline that does not exist, or pressure anyone.
- Variant A of each live experiment is the copy that goes out today. Any new variant starts `approved: false`: a
  district dealt that variant is queued `held`, Anthony reads the first batch, and releases it with
  `python3 tools/outreach/run.py release-variant <experiment> <variant>`, then sets `approved: true` in
  `experiments.yaml` so the next batch is not held.
- One touch per district per 10 business days. The ledger is how you check: the last move for a district is in
  `next-targets.json` and in `moves.jsonl`.
- Never spend on the Anthropic API. The model writes through `claude -p` on the Max plan.
- A district's id is its NCES id, else `ST|slug-of-name` (`common.district_id`).

## Files

| file | what |
|---|---|
| `data/game/score.json`, `score-history.jsonl` | the scoreboard now, and one line per run |
| `data/game/moves.jsonl`, `outcomes.jsonl` | the ledger |
| `data/game/experiments.yaml`, `assignments.json` | the variants, and which district got which |
| `data/game/report.md`, `next-targets.json` | what the experiments say, and who to ask next |
| `out/game/review-<date>.md` | the weekly page (not committed) |
| `data/nces/lea-enrollment-2023-24.csv`, `data/geo/county-adjacency.csv` | enrollment per district; which counties touch |

## For a Ground Crew agent

Read `score.json` for where the game stands and `next-targets.json` for the ten districts worth a move this week.
Before a move, check `moves.jsonl` for the district's last touch. After a move, `record_move`; when something comes
back, `record_outcome`. If you want to try a new message, do not send it: write it as a variant in
`experiments.yaml` with `approved: false` and say why in `question`.
