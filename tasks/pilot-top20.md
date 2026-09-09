# Pilot: the top 20 districts

Started 2026-09-09. Purpose: measure what one district costs to source (agent tokens, wall time, hit rate) before pointing a crowd at 4,400 of them, and put sourced policies on the map where the paddling actually happens.

**Selection.** Districts ranked by students who received corporal punishment in 2023-24, computed from the raw federal file (`data/crdc/2023-24/top-districts.csv`, the top 200). The top 20 are 11 Alabama county systems, 4 Texas ISDs, 4 Mississippi districts, and 1 Georgia county. Together they account for about 4,300 of the 19,851 students in the file, which is 22 percent of all school paddling in the country in one year, in 20 boards.

**Why only these states.** District policy matters only where state law permits the practice, so the scan covers the 17 permitting states and, within them, the roughly 830 districts that reported any use in 2023-24 first. The other 3,500 districts in those states get a lighter pass later (most have a handbook that says nothing or prohibits it).

**Method.** Four agents, five districts each, running the `district-policy-scan` skill's steps inside a Claude Code session (no API spend). Results merged into `data/districts/<XX>.yaml` with `source`, `quote`, `policy_code`, `last_verified`, and `crdc_students_latest`.

**Results (2026-09-09).** Twenty of twenty sourced with the policy text opened and quoted verbatim. Nineteen allow corporal punishment; one, Pike County, Alabama, prohibits it under a policy revised June 17, 2024, after the 2023-24 data year in which it reported 252 students struck. That is the first documented district switch in the top 20 and is now a case study. None of the twenty requires opt-in parental consent; several (Calhoun County AL, Jackson County AL, Chickasaw County MS, Scott County MS) have no opt-out language at all, Butler County AL says a parent's written objection is non-binding, and DeKalb County AL says the board 'does not recognize a no-paddle list'. The Alabama policies are largely the state school boards association's model text, often verbatim, which means one model-policy change at the association would move most of the state.

| Metric | Value |
|---|---|
| Districts attempted | 20 |
| Sourced with verbatim quote | 20 (19 allows, 1 bans) |
| Unknown after search | 0 |
| Agent tokens total / per district | 551,882 / 27,600 (four agents: 161k, 151k, 126k, 114k) |
| Wall time (parallel) | 15 minutes for 20 districts, 4 agents; 7 to 15 minutes per batch of 5 |
| Extrapolation to 830 districts with any use | about 23 million agent tokens; 10 hours of wall time with 4 agents, about 2 hours with 20; on a Claude Max plan the marginal dollar cost is zero, on the API it is whatever the model's per-token rate makes 23 million tokens |

**What made it expensive.** This session's web-search budget was already exhausted, so every agent found policies by direct fetching and by driving Chrome for the JavaScript-only policy vendors (Simbli, TASB Policy Online, Apptegy). Roughly a third of the tool calls were wasted on bot challenges. A fresh session with search available, plus the vendor notes now in AGENTS.md, should come in well under 20,000 tokens per district.

**What to fix before scaling.** (1) Simbli policy URLs carry session tokens; record the stable `PolicyListing.aspx?S=<id>` entry as well. (2) Scanned PDFs with no text layer (Dale County, Covington County) need OCR; macOS Vision worked for one. (3) Two districts (South Panola, Marshall County) publish the current manual behind a login and only a handbook or an old PDF is public; the entry says so. (4) Chrome is shared across agents; each agent must verify the page title before reading.
