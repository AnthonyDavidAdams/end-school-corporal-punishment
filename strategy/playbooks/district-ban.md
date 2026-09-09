# Playbook: ending corporal punishment in one district

School boards are the cheapest lever in American politics. Five to nine members, public meetings, three-minute comment slots, and elections decided by a few hundred votes. Most of the districts that have ended corporal punishment did it this way, without a state law. Kentucky and North Carolina reached zero paddling districts before their legislatures acted.

## Step 1: Know the district (agent work, one evening)

- Policy: `data/districts/<XX>.yaml`. If it is `unknown`, run `district-policy-scan` for the district first.
- Numbers: the district's rows in `data/crdc/` by school, by sex, race, disability.
- The board: `crm/dossiers/<XX>/<district>.yaml`. If it does not exist, run `decision-maker-dossier`.
- Neighbors: every district within 50 miles that has banned it, from `data/districts/`.
- Meetings: schedule, agenda deadline, public comment rules, from the district site.

## Step 2: Find the constituents (people work, two to four weeks)

You need, in the district: three parents of current students, one teacher or retired teacher, one pediatrician, family doctor, or nurse, one pastor or congregation leader, one former student who was paddled and is willing to say so, and one business owner. Eight people. The CRM matches them to members by shared public affiliation. Recruit through the parents already filing opt-out letters; they self-identify.

## Step 3: Opt-outs first (parallel, ongoing)

Every parent you meet files `templates/letter-principal-opt-out.md`. Ask the district, by records request (`templates/public-records-request.md`), how many refusals are on file. That count is a number the board cannot ignore and a story for the local paper.

## Step 4: The first meeting: information, not confrontation

One speaker, the most credible parent. Three minutes (`templates/testimony-school-board.md`): who they are, the district's own numbers, the neighbors that stopped, and the smallest ask: put a policy review on next month's agenda and honor every refusal until then. Leave a packet with the clerk: numbers, the model policy, the neighbor list, the AAP statement.

## Step 5: Between meetings: the letters

Each of the eight constituents writes to the member they were matched with, in their own words, using the structure in `persuasion.md`. Log every contact and reply in the dossier. Count votes. Do not go to the second meeting without a count.

## Step 6: The second meeting: the ask

If the count is there, the ask is adoption of `templates/district-policy.md` with an effective date and a training plan (`training/`, free). Three speakers: parent, teacher, physician. If the count is not there, the ask is a narrowing step: written opt-in consent, no use on students with disabilities, principal-only administration, and a published annual count. Every narrowing step cuts use and builds the next vote.

## Step 7: After the vote

- Win: send the training offer to the superintendent the same week. Write the case study in `strategy/case-studies/` with what worked. Update `data/districts/`. Thank the members publicly.
- Loss: write the case study anyway, with the arguments used against, and add them to `opposition.md`. Find out when each opposing member's seat is up. Keep filing opt-outs.

## What not to do

No petitions from outside the district, no form emails, no social media campaigns naming board members, no contacting anyone at home or work. See `persuasion.md` section 6 and the code of conduct. These lose, and they hand the district a reason to dig in.
