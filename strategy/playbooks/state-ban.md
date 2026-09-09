# Playbook: a state ban

State bans pass when they change little in practice. Colorado banned corporal punishment in 2023 after 154 of its 178 districts already had. Kentucky's and North Carolina's districts reached zero on their own. New Mexico in 2011 and Idaho in 2023 passed with bipartisan votes. The details of each are in `case-studies/`. The pattern:

## Preconditions

1. A majority of districts already prohibit it, or the count of students affected is small and concentrated. Check `data/districts/<XX>.yaml` and `data/crdc/`.
2. A sponsor in the majority party. In most remaining states that means a Republican sponsor with a parental-rights or fiscal-liability frame. `persuasion.md` section 2.
3. The state school boards association and the state teachers' association are neutral or supportive. Their model policies matter more than their testimony; if the association's model policy still contains a corporal punishment clause, get that changed first.
4. An answer to "what instead" that costs the state nothing. `training/` plus the state's existing MTSS or PBIS framework and Title IV-A funds.

## The bill

Start from `templates/state-ban-act.md`. Keep the reasonable-force exceptions; every successful bill has them and their absence is the opposition's first attack. Consider including private schools only if the count of states with private-school bans in `facts/` supports the precedent argument; otherwise leave it for a later session.

## Sequencing when preconditions are missing

Pass what can pass, in this order, each with its own bill: (1) prohibition for students with disabilities; (2) written opt-in parental consent, annually renewed; (3) principal-only administration, another adult present, written record; (4) annual public reporting by school; (5) the full ban. Florida moved to opt-in consent in 2025; Louisiana, Oklahoma, and Tennessee have taken or debated the disability step. See `narrowing.md` and `data/states/`.

## The hearing

Witnesses in this order: a parent from the sponsor's district, a pediatrician, a superintendent from a district that stopped and saw no chaos, a teacher, a former student. Written testimony from every organization in `facts/claims/org-*.md`. `templates/testimony-legislative.md`. The opposition will say local control, parental rights, "it works", and "then what". `opposition.md` has the response to each; the local-control answer is the district count.

## After passage

Update `data/states/<XX>.yaml` and the map, write the case study, and send the training to every district that was still paddling; they have to change practice on a deadline and will take free help.
