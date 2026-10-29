# Missouri research-ask experiment: the twelve test districts

Chosen 2026-10-29 from `data/districts/MO.yaml` (status `allows` or `consent_required`), crossed with `data/outreach/policy-lag.json` (permitting boards that reported zero students in the 2023-24 Civil Rights Data Collection) and `data/crdc/2023-24/districts.csv` (students who received corporal punishment in 2023-24). Enrollment is the 2023-24 figure in `data/nces/lea-enrollment-2023-24.csv`; the band is the one `tools/game/common.py` uses (tiny under one thousand, small one to five thousand). Any district with an open thread in `data/outreach/requests.json` (status sent, needs_review, promised, anthony_replied, held, pending or bounced) was excluded; six permitting districts were dropped on that rule. Districts whose record carries two conflicting entries (Eminence R-I) were skipped.

Every permitting Missouri district on the record is tiny or small, so "across enrollment bands" here means three tiny and three small in each arm, with the tiny arm spread from under five hundred to just under one thousand. Each arm also has two `allows` boards and four `consent_required` boards, so the two arms match on paper status as well as size. The state picture the copy rests on: one hundred twenty-eight boards permit (forty-six allow, eighty-two require written consent), one hundred twenty-five prohibit in writing, seventy-two permitting boards reported zero, and one thousand and two Missouri students were paddled in 2023-24.

## Arm 1: reported uses in 2023-24

| District | County | NCES | Status | Parent control | Enrollment | Band | Students paddled 2023-24 | Dossier |
|---|---|---|---:|---|---:|---|---:|---|
| Greenville R-II | Wayne | 2913380 | consent_required | opt_in | 677 | tiny | 141 | `crm/dossiers/MO/greenville-r-ii.yaml` |
| Holcomb R-III | Dunklin | 2914460 | consent_required | opt_in | 452 | tiny | 41 | `crm/dossiers/MO/holcomb-r-iii.yaml` |
| Malden R-I | Dunklin | 2919890 | allows | opt_out (handbook) | 846 | tiny | 62 | `crm/dossiers/MO/malden-r-i.yaml` |
| Kennett 39 | Dunklin | 2916500 | consent_required | opt_in | 1,875 | small | 38 | `crm/dossiers/MO/kennett-39.yaml` |
| Cassville R-IV | Barry | 2908170 | consent_required | opt_in | 1,964 | small | 7 | `crm/dossiers/MO/cassville-r-iv.yaml` |
| McDonald County R-I | McDonald | 2920610 | allows | unknown | 3,486 | small | 27 | `crm/dossiers/MO/mcdonald-co-r-i.yaml` |

Why each one:

- **Greenville R-II.** The most students paddled of any Missouri district in 2023-24, in a district of under seven hundred: about one student in five. If any board in the state has a reason it can state, this one should. Policy JGA-1 with the statutory consent sentence.
- **Holcomb R-III.** Second-highest rate in the state after Greenville (forty-one of four hundred fifty-two). The smallest district in the arm, so the board is a handful of people who all know the practice first-hand.
- **Malden R-I.** Reported sixty-two students, and its handbook still says the district "retains the legal right to administer reasonable corporal punishment" with an opt-out, four years after RSMo 160.261 moved the state to written opt-in. The only district in the sample whose own document uses the word "reasonable", and a district where the paper may lag the statute rather than the practice.
- **Kennett 39.** The largest Dunklin County district and the county seat; thirty-eight students. Dunklin and Pemiscot counties account for a large share of the state total, and Kennett is the district the smaller bootheel boards look to.
- **Cassville R-IV.** The one Missouri board with a national public record on this exact question: it reinstated opt-in paddling in 2022 and its administrators explained why on the record. Seven students in 2023-24. The dossier should carry the board's own stated reasoning, which makes it the best test of whether a sincere question about evidence gets a sincere answer.
- **McDonald County R-I.** The largest permitting Missouri district that reported uses (about thirty-five hundred students, twenty-seven paddled). Its handbook lists corporal punishment as a first-offense consequence for phone violations; no JGA policy code is on the record yet, which the dossier run should settle.

## Arm 2: permitting on paper, reported zero in 2023-24

| District | County | NCES | Status | Parent control | Enrollment | Band | Students paddled 2023-24 | Dossier |
|---|---|---|---:|---|---:|---|---:|---|
| Princeton R-V | Mercer | 2925590 | allows | unknown | 374 | tiny | 0 | `crm/dossiers/MO/princeton-r-v.yaml` |
| Monroe City R-I | Monroe | 2921210 | consent_required | opt_in | 685 | tiny | 0 | `crm/dossiers/MO/monroe-city-r-i.yaml` |
| Caruthersville 18 | Pemiscot | 2907470 | consent_required | opt_in | 922 | tiny | 0 | `crm/dossiers/MO/caruthersville-18.yaml` |
| Dexter R-XI | Stoddard | 2910770 | allows | unknown | 1,782 | small | 0 | `crm/dossiers/MO/dexter-r-xi.yaml` |
| Marshfield R-I | Webster | 2920430 | consent_required | opt_in | 2,893 | small | 0 | `crm/dossiers/MO/marshfield-r-i.yaml` |
| Grandview R-II | Jefferson | 2913170 | consent_required | opt_in | 3,306 | small | 0 | `crm/dossiers/MO/grandview-r-ii.yaml` |

Why each one:

- **Princeton R-V.** North Missouri, far from the bootheel cluster. Policy 2670 (the MSBA model) says the paddle "should be used only after other methods have failed and when there is reason to believe it will be helpful", so the policy itself asks the research question. Zero reported.
- **Monroe City R-I.** Northeast Missouri, the same 2670 language, consent required, zero reported. A second region so the zero arm is not one geography.
- **Caruthersville 18.** Pemiscot County, surrounded by the heaviest users in the state, and reported zero. The natural neighbor comparison for Greenville, Holcomb, Malden and Kennett: same county seat economy, same policy code, different practice.
- **Dexter R-XI.** Stoddard County, in the bootheel, status `allows` from a 2018-19 handbook that lists corporal punishment as a first-offense consequence. Zero reported. The dossier should find the current handbook; if the consequence is gone from it, the record flips without a letter.
- **Marshfield R-I.** Southwest Missouri on the Interstate 44 corridor, nearly three thousand students, consent required "when other disciplinary methods have failed". Zero reported. A growing district whose policy language already concedes the paddle is a last resort.
- **Grandview R-II.** Jefferson County, the St. Louis exurbs, the largest permitting Missouri district that reported zero. Policy 2670, consent required. If a board this close to the metro keeps the clause out of habit, it is the one most likely to answer "no file" and act on it.

## Variant assignment

Assignment is by `tools/game/assign.py`: a hash of district id and experiment id, dealt round-robin within each (state, band) stratum across every Missouri district on the record, and frozen in `data/game/assignments.json` the first time it is built. The twelve above will therefore not split four-four-four by design; the dry run in `README.md` shows the deal, and the experiment should read across the whole Missouri permitting set over time, with these twelve as the first held batch.

## Correction to the brief

The brief said the districts' policies and RSMo 160.261 "use the words reasonable and necessary". Checked 2026-10-29 at revisor.mo.gov: RSMo 160.261.10 protects spanking administered "in a reasonable manner in accordance with the local board of education's written policy of discipline" and "the use of reasonable force to protect persons or property". The word "necessary" is in RSMo 563.061.1, the justification statute, which covers a teacher only when the teacher "reasonably believes that the force used is necessary ... to maintain reasonable discipline in a school, class or other group". Of the one hundred twenty-eight permitting policies on the record, six use "reasonable" (Malden's handbook among the twelve) and none uses "necessary". The variants quote the statutes, not the policies, for those two words.

## What the dossier run found, 2026-10-29

Thirteen dossiers are in `crm/dossiers/MO/`. Presidents, by district: Greenville R-II, Steve Marler; Holcomb R-III, Autumn Burk; Malden R-I, Carolyn Cornman; Kennett 39, Matthew R. Shetley; Cassville R-IV, Chad Yarnall; McDonald County R-I, Josh Banta; Princeton R-V, Ron Parsons; Monroe City R-I, Darin Yager; Caruthersville 18, Jimmy Lyons; Dexter R-XI, Saren Demaree; Marshfield R-I, Mark Messick; Grandview R-II, not established (the district site is bot-gated; the seven members are known from county election records). Values quotes in members' own words exist for Cassville (seventeen, including the 2022 vote and the superintendent's public reasoning), Grandview (fifteen, from Leader Publications candidate questionnaires) and McDonald County (eleven, from a 2020 candidate Q and A); the other nine boards have no member on the record saying anything, so framing for them defaults to local control and the district's own policy language. Position on corporal punishment is `unknown` for every member except Cassville's five who voted to reinstate in June 2022 (`opposes_ban` on the strength of that one vote).

Four record questions the run turned up. None has been changed in `data/districts/MO.yaml` (another session has that file open); each needs a maintainer's read before a letter goes to the board:

- **Monroe City R-I.** The board moved its manual from MSBA to EdCounsel in a seven to nothing vote on October 14, 2024, and the EdCounsel manual adopted July 1, 2025 (S-170-P) says "Corporal punishment is strictly prohibited as a method of discipline." The MSBA portal still shows the 2022 policy 2670 that the record quotes. If the EdCounsel text is the board's current policy, the district is a `bans` and leaves this sample for the record-correction path (certificate), not a research ask.
- **Princeton R-V.** The MSBA portal's 2670 (last updated 2010) authorizes the paddle and carries no written-permission sentence; the district's own published 2000-series policy PDF (reviewed 2018) titles 2670 "Corporal Punishment: Prohibited" and bars any employee or volunteer from administering it. Same consequence as Monroe City if the district's own PDF is the current text.
- **Marshfield R-I.** The current policy is EdCounsel S-170-P (not JGA or 2670) and requires "notification to and written permission of a parent/guardian"; the 2026-27 handbooks still say "consent". Status `consent_required` stands; the policy code and source should be updated.
- **Dexter R-XI.** Policy 2670 as published by the district (as of July 1, 2022) authorizes corporal punishment with no parental-permission language, and the 2026-27 high school handbook still lists it as a first-offense consequence for about a dozen infractions. Status `allows` stands; the handbook source should move from the 2018-19 PDF to the current one. The absence of the statutory opt-in sentence is itself a question for the board.

Two smaller ones: McDonald County's enrollment packet carries a "Corporal Punishment Consent" yes or no checkbox (wooden paddle, three swats), while the handbook text read does not contain the "written permission" sentence the record quotes; and Malden's board policy JGA-1 on Simbli could not be read (JavaScript-only), so whether it has been updated from the handbook's opt-out to the statutory opt-in is open.

If Monroe City and Princeton leave the sample, the alternates from the same cross, in the same bands, with no open thread, are Scott City R-I (Scott County, NCES 2915450, allows, 828 students, zero reported) and Dora R-III (Ozark County, NCES 2910950, allows, 608 students, zero reported); both would need a dossier before queueing.
