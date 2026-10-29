# Missouri research ask: a held experiment

Staged 2026-10-29. Nothing in this folder has been sent, and nothing sends until Anthony sets `approved: true` on a variant in `data/game/experiments.yaml`. That file is the approval switch; this folder is the reading guide.

## What is being tested

Missouri boards that keep corporal punishment say, in their own policy language, that it is a last resort (policy 2670: "only after other methods have failed"), and Missouri law protects it only when done "in a reasonable manner" (RSMo 160.261.10) by an adult who "reasonably believes that the force used is necessary" to keep discipline (RSMo 563.061.1). One hundred twenty-five Missouri boards manage without it. The experiment asks a small number of boards, sincerely, what they relied on to decide it is necessary, and measures which way of asking gets an answer.

| Variant | Name | To | What changes |
|---|---|---|---|
| A | records request, what the board relied on | superintendent | the live `ask_research()` in `tools/outreach/messages.py`, unchanged: a Sunshine Law request for five categories of records. Control. |
| B | plain question to the board president | board president, by name | one question, no statute request, no research recited, a face-saving exit ("no file" is a fair answer) |
| C | the question, the norm and the offer | board president, by name | B plus the JGA-2 sentence twenty-eight boards use, the Safe School recognition, and the link to the board brief, framed as "no ask attached" |

B and C share a subject line on purpose, so the C-versus-B read is the norm and the offer, not the subject. A differs from B in recipient as well as copy (the control goes to the superintendent, as the three research requests already sent did); that is a confound the first read has to live with, and it is noted here so nobody reads A-versus-B as a pure copy test.

Both arms of the district sample get every variant. The arms (six boards that reported uses in 2023-24, six that reported zero) are in `districts.md` with the reason for each.

## Files

- `districts.md`: the twelve test districts, the selection rule, the arm design, and a correction to the brief about where the words "reasonable" and "necessary" actually appear.
- `experiments.yaml` lives in the engine, not here: the three variants were added to `data/game/experiments.yaml` as experiment `ask_research` (kind `research`, status `live`, every variant `approved: false`). The file had no uncommitted changes from another session when this was written, so it was edited in place.
- `crm/dossiers/MO/<district-slug>.yaml`: one public-record dossier per test board, with the president, the members, the policy, the CRDC count, and the values quotes that drive framing. `crm/dossiers/MO/legislature.yaml`: the House and Senate education committees and the sponsors of the four ban bills.
- `legislators.md`: the two legislator notes (committee chairs; the four sponsors), held, not sent.

## How the twelve get queued, and what Anthony reads

The engine holds any request whose variant is unapproved, so queueing is safe. Nothing below has been run.

1. Read `districts.md`, the dossiers, and the three variants in `data/game/experiments.yaml`. Settle the four record questions at the end of `districts.md` first: Monroe City and Princeton may already prohibit under their current manuals, in which case they leave the sample. Grandview's president could not be established; for a B or C deal there, `{who}` renders "there" unless the name is filled in from the board page by hand.
2. Queue the twelve as `research` requests. There is no `queue_research` in `tools/outreach/run.py`; the three earlier research requests were added by hand. The shape of a request is the one `queue()` writes, with `kind: research`, `statute` set to the Missouri Sunshine Law string already used on Missouri requests ("the Missouri Sunshine Law, RSMo § 610.010 et seq."), `to` the published district address from the dossier (`superintendent.email`, or the board's published address), and `superintendent` set to the person the variant greets: for A the superintendent's name; for B and C the board president's name, because `{who}` renders the first name of that field. Use an id of `sha1("MO|<nces_id>|research")[:10]` so it cannot collide with a policy request for the same district. Then call `tools/game/assign.apply(request)`, which stamps `experiment: ask_research`, the variant, and `status: held`.
3. Build the deal once with `python3 tools/game/assign.py`; it writes `data/game/assignments.json`. The dry run on 2026-10-29 (nothing written) dealt the twelve as: A for Holcomb, Malden, McDonald County, Marshfield and Caruthersville; B for Dexter and Princeton; C for Greenville, Kennett, Cassville, Grandview and Monroe City. Across all Missouri districts on the record the deal is balanced (109, 109, 106); within any twelve it will not be, and that is expected.
4. Read the held batch: the twelve requests in `data/outreach/requests.json` with `status: held` and `experiment: ask_research`, and render any one with `python3 -c` on `tools/game/assign.body(request)` to see the exact text with the names filled in. Check each `{who}` against the dossier before approving.
5. Approve by setting `approved: true` (and `approved_by`, `approved_on`) on each variant in `data/game/experiments.yaml` that should go. The hourly cycle sends held requests whose variant is approved. A variant left `approved: false` keeps its requests held indefinitely; set the request `status` to `dropped` to retire them.

## Scoring: what counts, matching `tools/game/report.py`

`report.py` reads `data/game/moves.jsonl` and `data/game/outcomes.jsonl`. A move is one request sent, stamped with `experiment: ask_research` and the variant. An outcome is anything that happened for the same district after the move. The definitions below are the ones the code uses; the research-specific reading is what each one means for this experiment.

**A reply** (`kind: reply`, counted if it lands within seven days of `sent_at`): any message back from the district on the thread, whatever it says. For this experiment a reply that says "there are no such records" or "the board has not taken this up" is a reply and a finding; it is what variant B's exit line invites. A bounce is not a reply. An auto-acknowledgement is filed by the inbox as a reply only if `handle_one` records it as one; check the thread before counting it.

**A document** (`kind: document`): a file or link the district sends that `file_document` files into `data/policies/inbound/MO/`. For this experiment that is the thing the board relied on: minutes of the meeting that kept the policy, a study, an administration memo, a training packet, the discipline matrix or incident log, or the policy itself if it is sent as the answer. A written statement that no records exist is a reply, not a document, unless it arrives as a letter on district paper, in which case the inbox files it and it counts as a document under the code's rule. The report cannot tell "sent the research" from "sent a no-records letter"; until it can, write which one it was into the request's `notes` as `research_answer: records | none | policy_only | declined` so the first read can be done by hand.

**A status flip** (`kind: status_recorded`, `policy_flip`, or `record_correction` with `detail.to: bans` and not retracted): the district's entry in `data/districts/MO.yaml` moving to `bans`, either because the board adopted a prohibition after the ask (`policy_flip`), because the district sent a current document showing the clause is already gone (`record_correction`), or because the record's status was set from a document the ask produced (`status_recorded`). A `certificate` outcome counts as a win too, because a certificate is only issued on a recorded prohibition. A flip from `allows` to `consent_required` (the board adding the statutory opt-in sentence) is a real policy change but is not a win in the report's terms; log it in the dossier's `contact_log` and in `strategy/case-studies/` so it is not lost.

**The reads.** `report.py` counts a move only once it is old enough for the window, so the table fills in over time:

- Seven days: reply rate per variant, over moves at least seven days old. The question this read answers is whether a plain question to a president gets answered where a Sunshine request gets silence or a records-office response.
- Fourteen days: win rate per variant (document or flip), over moves at least fourteen days old. For research requests the statutory response clock is three business days to acknowledge, so fourteen days separates boards that engaged from boards that did not.
- Thirty days: win rate per variant over moves at least thirty days old. Boards meet monthly; thirty days is one meeting cycle, the earliest a board could have put anything on an agenda because of the ask. This is the only window where a `policy_flip` is plausible.

With twelve moves dealt five, two and five, none of the three rates will be significant. The first read is qualitative: what did each board say it relies on, in its own words, and did anyone send a document. Record each answer in the district's dossier under `contact_log` and the gist in `strategy/case-studies/`. The statistical read comes as the rest of the Missouri permitting set is dealt the same three variants.

`python3 tools/game/report.py` prints the table and writes `data/game/report.md`.

## Sources behind the copy, checked 2026-10-29

- RSMo 160.261 at revisor.mo.gov: subsection 1 requires the written discipline policy to include "the district's determination on the use of corporal punishment" and bars corporal punishment "without a parent or guardian being notified and providing written permission"; subsection 10 protects spanking "in a reasonable manner in accordance with the local board of education's written policy of discipline" and "the use of reasonable force to protect persons or property".
- RSMo 563.061.1 at revisor.mo.gov: force by a teacher is justified when the teacher "reasonably believes that the force used is necessary to promote the welfare of a minor ... or to maintain reasonable discipline in a school, class or other group".
- Ingraham v. Wright, 430 U.S. 651 (1977), Part II, read at law.cornell.edu: the common-law test weighs "the seriousness of the offense, the attitude and past behavior of the child, the nature and severity of the punishment, the age and strength of the child, and the availability of less severe but equally effective means of discipline", citing Restatement (Second) of Torts § 150, Comments c-e. The brief attributed the "less severe but equally effective" phrase to § 150 itself; it is the Court's sentence, drawing on the Restatement's comments. Cite it as Ingraham.
- Restatement of the Law, Children and the Law § 8.10, Use of Force to Control and Punish, Tentative Draft No. 2 (ALI Adviser post of 2019-04-12): the black letter says "The use of force to punish through the infliction of pain is not necessary to maintain order or safety." Status: the draft was presented for approval at the 2019 Annual Meeting, and the ALI announced the full Restatement approved by the membership on 2024-05-17 with the official text still in preparation; later drafts renumbered the discipline chapter (the ALI Adviser lists it as § 7.10 and a 2025 ABA article footnotes § 6.01), so cite the section by title and draft, not by number, until the official text is out. Not used in the board copy; usable in testimony.
- The research the copy does not recite (it is in `facts/claims/`, verified): Visser, van der Put and Assink 2022 (school meta-analysis, `study-visser-2022-school-meta-analysis`), Gershoff and Grogan-Kaylor 2016, Gershoff, Sattler and Holden 2019, Korpershoek 2016 (what replaces it), and the American Academy of Pediatrics 2023 school statement. The persuasion playbook's warning stands: reciting it in the opener reads as condescension. The variants ask what the board relies on and offer to read it.
- State figures from the repository on 2026-10-29: 128 permitting boards (46 allow, 82 consent_required), 125 prohibit in writing, 72 permitting boards reported zero in 2023-24, 1,002 Missouri students paddled in 2023-24 (sum of `data/crdc/2023-24/districts.csv`), 28 boards using the JGA-2 modal sentence per `data/states/model-language.json` (31 by a direct count of the quote in `MO.yaml`; the engine's figure is the one the template renders).

Another session was writing claim files for the same sources on 2026-10-29 (`facts/claims/law-immunity-missouri-160-261.md`, `law-restatement-second-torts-147-150.md`, `law-ali-restatement-children-8-10.md`, untracked at the time); once committed they are the citations to use, and they agree with the readings above.

## Follow-ups, not done here

- `messages.ask_research()` carries one em dash ("imposed for" ... "the incident log"); fix it in `tools/outreach/messages.py`.
- A `{president}` template field in `tools/game/assign.py` would stop B and C from borrowing the `superintendent` field for the president's name.
- A `research_answer` detail on `reply` and `document` outcomes would let `report.py` separate "sent the research" from "no records", which is the finding this experiment is for.
- `strategy/outreach/drafts/legislators.md` is written to the 2026 committee chairs; the November 2026 election and January 2027 committee assignments may change the names before the 2027 session opens.
