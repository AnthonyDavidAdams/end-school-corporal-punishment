# 2020-21 CRDC extract

Downloaded 2026-10-05 from https://civilrightsdata.ed.gov/assets/ocr/docs/2020-21-crdc-data.zip (HTTP 200, 81,589,466 bytes, `application/x-zip-compressed`).

A second URL, https://civilrightsdata.ed.gov/assets/ocr/docs/2020-2021-crdc-data.zip, returned HTTP 200 with `Content-Type: text/html` and 3,362 bytes, which is the site shell rather than a zip. It was not used.

- SHA-256 of the zip: `1ccf87e16aa3d0778a98e776400782480f314ffbe9adbb53f4cc73e9954990db`
- File inside the zip: `CRDC/School/Corporal Punishment.csv` (zip entry dated 2023-06-21, 29,683,014 bytes uncompressed)
- SHA-256 of that CSV: `b1a96703bffda8bb9ed6707c5efe4296d850f2d02548c949bcea67b6b61c5447`
- 97,575 school rows and 17,821 LEAs in the CSV

This is a pandemic year. Most students were remote for part of it. The count is not comparable to other years. It counts students who received corporal punishment at least once, not incidents, and districts self-report.

`tools/crdc/extract.mjs` sums `TOT_DISCWODIS_CORP_{M,F}` and `TOT_DISCWDIS_CORP_IDEA_{M,F}` and treats negative reserve codes as zero. Script output: 19,683 students; 26,001 instances; boys 16,124; Black 4,604; IDEA 3,231; 2,056 schools; 979 LEAs. A standards-compliant parse matches those totals. Girls, from the same total columns, are 3,559. Without disabilities 16,452. Race columns sum to 19,683: Hispanic 2,345; American Indian or Alaska Native 464; Asian 40; Native Hawaiian or Other Pacific Islander 22; Black 4,604; White 11,604; two or more races 604. This file has no nonbinary corporal-punishment columns.

The script skips 75 positive instance values at schools with no positive student total. `SCH_CORPINSTANCES_IND` is Yes at 2,824 schools, No at 80,889, -11 at 10,212, and -13 at 3,650.

`SCH_DISCWDIS_CORP_504_{M,F}` sums to 905 and is not in the 19,683. Preschool is separate and is not in the 19,683: `TOT_PSDISC_CORP_{M,F}` sums to 469, `SCH_PSCORPINSTANCES_ALL` sums to 746, and `SCH_PSDISC_CORP_IDEA_{M,F}` sums to 56.

`per_1000_enrolled` is blank. This run did not recompute enrollment rates.

## Disagreement with the estimations API

A pending crew finding, `finding_fe77598f2456`, records 19,395 students from the OCR estimations API (non-IDEA 16,181 plus IDEA 3,214). This zip extract is 19,683, which is 288 higher. The whole gap is in four states: Texas 6,409 versus 6,153, Oklahoma 1,598 versus 1,579, Arkansas 2,690 versus 2,678, Mississippi 2,306 versus 2,305. The other twelve states in that finding match this file. Both figures are OCR's. This folder uses the school-level zip. No second finding was submitted for 2020-21 because that API finding was already pending. The disagreement is filed as issue_1c19b278d9c5.

## Files

`national.csv`, `states.csv`, and `districts.csv` use the script's rule. `districts.csv` lists 979 LEAs and sums to 19,683. `states.csv` lists 16 states. `section_504` is not included in `students`.
