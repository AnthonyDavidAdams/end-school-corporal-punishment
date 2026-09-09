# Pilot: the top 20 districts

Started 2026-09-09. Purpose: measure what one district costs to source (agent tokens, wall time, hit rate) before pointing a crowd at 4,400 of them, and put sourced policies on the map where the paddling actually happens.

**Selection.** Districts ranked by students who received corporal punishment in 2023-24, computed from the raw federal file (`data/crdc/2023-24/top-districts.csv`, the top 200). The top 20 are 11 Alabama county systems, 4 Texas ISDs, 4 Mississippi districts, and 1 Georgia county. Together they account for about 4,300 of the 19,851 students in the file, which is 22 percent of all school paddling in the country in one year, in 20 boards.

**Why only these states.** District policy matters only where state law permits the practice, so the scan covers the 17 permitting states and, within them, the roughly 830 districts that reported any use in 2023-24 first. The other 3,500 districts in those states get a lighter pass later (most have a handbook that says nothing or prohibits it).

**Method.** Four agents, five districts each, running the `district-policy-scan` skill's steps inside a Claude Code session (no API spend). Results merged into `data/districts/<XX>.yaml` with `source`, `quote`, `policy_code`, `last_verified`, and `crdc_students_latest`.

**Results.** Filled in below when the run completes.

| Metric | Value |
|---|---|
| Districts attempted | 20 |
| Sourced with verbatim quote | |
| Unknown after search | |
| Agent tokens total / per district | |
| Wall time (parallel) | |
| Extrapolation to 830 districts with any use | |
