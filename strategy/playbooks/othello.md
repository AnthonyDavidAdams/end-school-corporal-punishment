# Playbook: flipping the neighbours

A school board is far easier to move with the district next door than with a study. This is the descriptive-norm lever from `persuasion.md`, applied geographically: when a county stops, its neighbours become the cheapest targets in the country, and each one that flips makes the next one cheaper. Colorado banned corporal punishment statewide only after 154 of its 178 districts had already stopped. Kentucky and North Carolina reached zero district by district before their legislatures did anything at all.

## Finding the targets

`pipeline/othello.mjs` in the School Policy Index ranks counties that still permit the practice and border a county that has stopped, using the Census county adjacency file and our own district records. Run it per state.

The first run, Alabama, keyed on Pike County, which revised policy 5.30.1 on June 17, 2024 to prohibit corporal punishment after reporting 252 students struck in 2023-24:

| Neighbour | Status | Students struck, 2023-24 |
|---|---|---|
| Coffee County | allows | 184 |
| Dale County | allows | 146 |
| Montgomery County | allows | not reported |
| Bullock, Crenshaw, Barbour | not yet recorded | unknown |

Six counties border Pike. Three have districts we have sourced and know permit it. Three we have not scanned yet, which is itself the work order: scan those first, because their answer decides whether they are targets or already allies.

Ranking is by share of the border that has stopped, then by students affected. A district with four of six neighbours stopped is a different conversation from one with one of six.

## The approach

Lead with the neighbour, not the research. The opening line is "Pike County stopped in June and their schools are fine," not a meta-analysis. Bring the neighbour's superintendent or a board member if they will come; a peer from forty miles away outranks any outsider with data.

Ask for the small thing first, per `district-ban.md`: put a policy review on next month's agenda. Offer the replacement in the same breath, because "then what do we do instead" is the argument that actually stops boards, and `training/` is a complete, free answer.

Then work outward. Each flip creates new borders, and the targeting tool re-ranks after every one.

## On offering a grant

The instinct to bring something, rather than only an ask, is right. Districts in these counties are small and under-resourced, and arriving with a gift changes the meeting.

But the gift has to be real, and this is worth getting right because the downside is severe.

**Do not offer a "$1,000,000 grant" of training and materials.** The curriculum is published under an open licence and anyone can download it, so it has no market value to assign. A board that votes to accept a million-dollar grant puts that in its minutes and possibly in an audit, and the money does not exist. Several states' gift-acceptance and ethics rules would be implicated. Most damaging, it hands the opposition the only line they need: an outside group tried to buy our board with money that was not there. One local reporter checking the figure ends the campaign in that county and probably in the state.

**Offer what the district actually lacks, which is staff time.** The training is free and always will be; the obstacle is that Module 1 costs roughly fourteen hours per teacher across ninety days, and a rural district cannot cover that. A sixty-teacher district needs something like twelve to eighteen thousand dollars of substitute coverage and stipends. That is a real number, it is auditable, it removes the actual barrier, and it is small enough to fund from sponsorships.

So the offer is: the curriculum and the model policy package, free, no strings, yours whether or not you change anything; plus, if the board adopts a transition plan, an implementation stipend of a named and honest amount to cover release time. Fund it from `FUNDING.md` and report it there.

If there is no money for stipends yet, say so and offer the free package alone. It is still the strongest thing anyone has brought them.

## What to log

Every contact goes in the decision-maker record per `../../crm/README.md`: who was approached, what was offered, what they said. Every vote, win or lose, becomes a case study with the argument that moved it. The targeting tool is only as good as the record behind it.
