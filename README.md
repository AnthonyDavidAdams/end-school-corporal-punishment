# End School Corporal Punishment

An open project to end the legal hitting of students in United States public schools, built so that anyone with an AI agent, a few dollars, a network, or an hour can move it.

Live map: [earthpilot.org/kids](https://earthpilot.org/kids/)

## The situation

- **24,534 students** received corporal punishment in US public schools in 2021-22, the newest year the Department of Education has analyzed. Our count from the raw 2023-24 file, released August 31, 2026, is 19,851. Both are students, not incidents, and both are self-reported by districts that the Department says likely underreport.
- **17 states** still permit it by statute. In two, Kentucky and North Carolina, every district has stopped by policy, leaving **15 states** where it is legal and in use. No state has enacted a ban since Colorado and Idaho in 2023.
- **Four states** (Texas, Alabama, Mississippi, Arkansas) account for **74 percent** of students struck. About **950 districts** and **2,050 schools** reported any use in 2021-22, out of 17,700 districts and 98,000 schools. The problem is concentrated, which is why it can be ended.
- **Boys are 81 percent** of those struck. **Black students are 26 percent** of those struck and 15 percent of enrollment; Black boys are 8 percent of enrollment and 20 percent of those struck.
- **36 of 38 OECD countries** prohibit it in schools. The exceptions are the United States and Australia.
- The American Academy of Pediatrics, the American Psychological Association, the NEA, the AFT, and more than 100 other organizations have called for an end to it. Two Secretaries of Education have written to every governor asking the same.

Every figure above is a file in [`facts/claims/`](facts/claims/) with its primary source and verification date. If one is wrong or stale, [say so](../../issues/new?template=fact-correction.yml).

## What this repository is

| Directory | What it holds |
|---|---|
| [`facts/`](facts/) | The claims registry: one publishable sentence per file, sourced, with a verification status |
| [`data/`](data/) | Legal status by state, policy by district, and federal Civil Rights Data Collection extracts, with JSON schemas and a validator |
| [`strategy/`](strategy/) | Theory of change, playbooks for district, state, narrowing, replacement, and federal levers, persuasion evidence, opposition arguments and answers, case studies |
| [`templates/`](templates/) | Model bill, district policy, board resolution, letters, testimony, public records request |
| [`training/`](training/) | An open, free curriculum for replacing corporal punishment in the schools that still use it |
| [`crm/`](crm/) | Public-record dossiers on the boards and committees that decide, and the rules for matching real constituents to them |
| [`skills/`](skills/) | Installable Claude Code skills that run the tasks below and end in a validated pull request |
| [`tasks/`](tasks/) | The open task queue |
| [`site/`](site/) | The static map, generated from `data/` on public-domain Census boundaries |

## How to help

**Bring an agent.** Most of the remaining work is reading thousands of district policy manuals and recording what they say, with sources. Install the skills and take a state:

```
claude plugin marketplace add AnthonyDavidAdams/end-school-corporal-punishment
claude plugin install escp@escp
claude
> /escp:district-policy-scan Mississippi
```

The skill files are plain Markdown and port to any agent. The contract every agent follows is [AGENTS.md](AGENTS.md).

**Bring money.** Sponsor the repository. Funds go to agent compute for the task queue, public records fees, and travel for testimony, in that order, with a public ledger in [FUNDING.md](FUNDING.md).

**Bring your network.** Share your state's page. If you are a parent in a state where this is legal, file the [opt-out letter](templates/letter-principal-opt-out.md) and pass it on. If you are a teacher, physician, psychologist, pastor, or lawyer, open an issue titled `[witness] <State>`.

**Bring an hour.** [CONTRIBUTING.md](CONTRIBUTING.md) lists the small tasks: verify one claim, add your own district's policy, review one training module.

## How it ends

District by district until a legislature is ratifying a fact rather than making a decision, then state by state until Congress is. That has been the pattern for fifty years and it is the plan here; [strategy/README.md](strategy/README.md) has the theory of change and the evidence behind each lever. Agents do the reading, counting, and drafting. People persuade the officials who represent them, under their own names. That split is what the persuasion research says works, and it is the line that keeps this from becoming the thing it opposes.

## The engine

This campaign is the first instance of a reusable structure for moving a public issue in the open with people and agents. [ENGINE.md](ENGINE.md) marks the issue-agnostic layers so they can be lifted out for the next issue.

## License

Content CC BY 4.0, code MIT. See [LICENSE](LICENSE). Map boundaries are US Census Bureau public domain via us-atlas. Federal statistics are public domain.

## Conduct

No student is ever named here. Officials' public positions and votes are documented; their private lives are not. Real people speak for themselves; no one writes in another's name. [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
