---
name: training-review
description: Review one module of the open replacement curriculum in training/modules/ against training/evidence.md and the claims registry in facts/claims/, opening every citation and marking each ok or not with a note. Use when asked to "review a training module", "check the curriculum's citations", or handed the training-review task.
---

# Training review

Argument: one module file in `training/modules/`, e.g. `03-office-response-ladder.md`.

The output is one review finding: every citation in the module, each marked ok or not, with a note, and a verdict on the module. A fix to the module itself is a separate pull request for that one module.

## Read first

- `training/README.md`: the module list and the layout every module follows (what it replaces, the evidence, the practice, a script or checklist, a handout, what to do when it is not working), and the principle "Evidence or silence".
- `training/evidence.md`: the sections the modules cite (A1 to A13 for harm, B1 to B10 for alternatives). Each is tagged VERIFIED, REPORTED or NOT VERIFIED, and many carry caveats.
- The module, end to end.

## Steps

1. `claim_task` with task `training-review`, your `agent`, `human`, and the module as scope. Renew before `expires_at`; release when you stop.
2. List every citation in the module. That means each reference to an `evidence.md` section (e.g. "B1"), each named study, organisation or figure, and each factual sentence with a number in it, even when it is uncited. Cross-references to other modules are not citations.
3. For each one:
   - Read the `evidence.md` section it points to. Note the tag and any caveat.
   - Open the primary source that section lists (the DOI, PubMed Central, or the official page) in this session. A secondary summary is not enough.
   - Find the matching claim with `search_facts` and `get_fact`. Note its id and `status`.
   - Compare the module's sentence with the source: the number, the population (school or parental, US or global), the design (trial or correlational), the year, and the size of the effect.
   - Mark it `ok` only if the source says what the module says, at the strength the module says it. Write a note either way, naming what you read.
4. Read the module as a whole for figures that appear in no source, for numbers that disagree with another module or with `training/README.md`, and for practices presented as evidence-based when `evidence.md` says the evidence is thin.
5. Choose the verdict: `accurate` if every citation is ok; `needs_fixes` if some are not and the module stands once they are reworded; `unsupported` if a central claim of the module has no support.
6. `submit_finding` with task `training-review`, the record below, and `skill` set to `training-review@0.1`.
7. To fix the module, open one pull request for that one file, citing the finding id, and apply only what the review found. Retired claims (`status: retired`) are not to be touched.

## The record

Shape: `crew/schemas/training-review-finding.schema.json`.

- `module`: the module's path, e.g. `training/modules/03-office-response-ladder.md`.
- `citations`: at least one item, each with:
  - `text`: the citation as it appears in the module, copied verbatim;
  - claim_id: the `facts/claims` id it rests on, or null;
  - `source`: the URL you opened;
  - `ok`: true or false;
  - `note`: what the source says, especially when it differs.
- `verdict`: `accurate`, `needs_fixes` or `unsupported`.
- `summary`: two or three sentences a maintainer can act on.
- `last_verified`: today's date.
- `notes`: anything you could not open, and why, with any issue id.

## Done means

- Every citation in the module was opened and is marked ok or not, with a note.

## Pitfalls

- **Claim status sets the wording.** Only a `verified` claim may be stated as fact. A `reported` claim may appear only as "according to <source>". A `disputed` or `retired` claim may not be used. A module that states a reported figure as fact is not ok, even if the figure is right.
- **Parental spanking is not school corporal punishment.** `evidence.md` A1 is a meta-analysis of parental spanking and is correlational. A module that uses it for a claim about schools, or says "causes", is not ok.
- **Claim no more than the trial measured.** The PBIS results in B1 come from schools implementing with fidelity, and some figures come from an abstract only. A sentence that names a component, outcome or effect size the source does not report is not ok.
- **The evidence is thin in places, and the module must say so.** `evidence.md` found no study measuring misconduct, suspensions or achievement after a US district or state abolished corporal punishment (A12, B9). A module implying a measured post-ban effect is not ok.
- **Uncited figures count.** A percentage with no source, such as a "3 to 5 percent of students" figure, is a citation marked not ok with the note "no source".
- **Paywalled sources.** If the full text is closed and the abstract does not settle it, mark it not ok, note "full text not opened", and `report_issue` so someone with access can read it. Do not mark it ok from memory.
- **Scripts with student names.** Module scripts use invented names. Flag any name or detail that could identify a real student.

## Before you start

Read `AGENTS.md` at the repository root. Its rules bind this skill: open every source, quote verbatim, date everything, never guess, no student names. When working in the repository, use a branch named `<task>/<scope>-<date>`; never commit to `main`.

## Finishing

1. Through the crew server: `release_lease`, and report the finding id, the verdict, and the citations that are not ok.
2. For a fix pull request: run `cd tools && npm i && npm run validate`, commit only the module file, and open the pull request with `gh pr create`, citing the finding id and including the agent disclosure line naming this skill and its version.
