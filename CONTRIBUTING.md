# Contributing

There are four ways to help. Pick the one that matches what you have.

## 1. You have an AI agent and compute

This is the fastest way to move the project. Most of the work is reading thousands of public documents and recording what they say, with sources. That is agent work.

1. Install the skills (Claude Code shown; the skill files are plain Markdown and port to any agent):
   ```
   claude plugin marketplace add AnthonyDavidAdams/end-school-corporal-punishment
   claude plugin install escp@escp
   ```
2. Read [AGENTS.md](AGENTS.md). It is the contract your agent must follow: open every source, copy quotes verbatim, never guess.
3. Pick a task from [tasks/README.md](tasks/README.md) and claim a scope with the "Claim a task" issue template so nobody duplicates it.
4. Run the skill, e.g. `/escp:district-policy-scan Mississippi` in Claude Code. It reads district policy manuals, writes `data/districts/MS.yaml` entries with source and quote, runs the validator, and opens a pull request.
5. A maintainer spot-checks the sources and merges.

Every merged PR moves districts from `unknown` to sourced, and the map at [earthpilot.org/kids](https://earthpilot.org/kids/) updates from this data.

## 2. You have money

Compute is the bottleneck, then public-records fees, then printing and travel to hearings. Sponsor the project through GitHub Sponsors on this repository. Funds pay for agent runs on the task queue, FOIA and open-records fees for district discipline records, and printed materials for school-board and legislative testimony. Spending is reported in `FUNDING.md`.

## 3. You have a network

- Share the state or district page for your own state. The `share/` folder has ready-to-post text and images per state.
- If you are a parent in one of the 15 states where this is still legal, file the opt-out letter in `templates/letter-principal-opt-out.md` and tell other parents to do the same. Districts change policy when the opt-out pile gets tall.
- If you are a teacher, pediatrician, psychologist, or lawyer, add your name to the testimony roster by opening an issue titled `[witness] <State>`.
- If you are a journalist, everything here is CC BY 4.0. Use it. Open an issue if you need a figure checked.

## 4. You have time

- Verify a claim: pick a file in `facts/claims/` with `status: reported`, open the primary source, and upgrade it to `verified` with the date.
- Add a district policy you can see on your district's website using the "District policy finding" issue template.
- Watch a legislature: the `bill-watch` task explains how to track bills in one state.
- Review a training module in `training/` if you have taught or run a school.

## Rules that apply to everyone

- **Sources or it does not merge.** Every fact, figure, and status carries a URL to the primary source and a verification date.
- **Verbatim quotes** for district statuses. Paraphrase is how errors creep in.
- **No student names, ever.** See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- **Run the validator** before opening a PR: `cd tools && npm i && npm run validate`.
- **Small PRs.** One state, one claim cluster, or one module per PR.
- **Disclose agents.** Say which agent and skill produced the change. That is not a mark against it; it helps reviewers know what to spot-check.

## Licensing of contributions

By contributing you agree that code is licensed under MIT and content under CC BY 4.0, as described in [LICENSE](LICENSE).
