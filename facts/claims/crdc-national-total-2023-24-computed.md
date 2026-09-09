---
id: crdc-national-total-2023-24-computed
claim: "In the 2023-24 school year, 19,851 K-12 public school students received corporal punishment, computed by this project from the raw Civil Rights Data Collection file released August 31, 2026; the Office for Civil Rights has published no analysis of that release."
status: verified
figure: 19851
as_of: "2023-24"
sources:
  - url: https://civilrightsdata.ed.gov/assets/ocr/docs/2023-24-crdc-data.zip
    title: "2023-24 CRDC public-use data file (SCH/Corporal Punishment.csv)"
    publisher: "US Department of Education, Office for Civil Rights"
    date: "2026-08-31"
    primary: true
  - url: https://www.npr.org/2026/09/04/nx-s1-5955681/civil-rights-data-schools-trump
    title: "Civil rights data on schools released without the usual analysis"
    publisher: "NPR"
    date: "2026-09-04"
    primary: false
tags: [crdc, national, computed]
last_verified: 2026-09-09
verified_by: "agent:claude (research pass 2026-09-09)"
---

Our computation, not an OCR publication. Method: sum of TOT_DISCWODIS_CORP_* and TOT_DISCWDIS_CORP_IDEA_* in SCH/Corporal Punishment.csv with reserve codes treated as zero; the identical script reproduces the official 2021-22 total (24,534) exactly. The file contains an evident reporting error: Salem City School District, New Jersey, a ban state, reports 380 students; excluding it the total is 19,471. Instances: 28,310. Schools reporting at least one student: 1,738 in 832 districts. The 2023-24 release came without a First Look report and with nonbinary fields suppressed; re-run when OCR publishes its own figures and retire this claim in favor of theirs.

## History
- 2026-09-09: created.
