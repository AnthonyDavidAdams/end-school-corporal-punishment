# 2023-24 CRDC extract

Downloaded 2026-10-05 from https://civilrightsdata.ed.gov/assets/ocr/docs/2023-24-crdc-data.zip (HTTP 200, 99,570,187 bytes).

- SHA-256 of the zip: `7471ce010c73804cfeddb50db28d0cf29d6d5a4fb903d4989cbb7a308f45475e`
- File inside the zip: `SCH/Corporal Punishment.csv` (zip entry dated 2026-08-06, 29,721,953 bytes uncompressed)
- SHA-256 of that CSV: `362093941ba22a0e507dbba9a5756ec12ff47b77a7a1cf259048ade697c56683`
- 97,094 school rows and 17,591 LEAs in the CSV

There is no official First Look figure for 2023-24 in this file. These numbers were recomputed in this repository on 2026-10-05 by `tools/crdc/extract.mjs`. Negative reserve codes are treated as zero. The student total is the sum of `TOT_DISCWODIS_CORP_{M,F,X}` and `TOT_DISCWDIS_CORP_IDEA_{M,F,X}`.

Script output: 19,851 students; 28,268 instances; boys 16,144; Black 5,266; with disabilities (IDEA columns) 3,385; 1,738 schools; 832 LEAs. A standards-compliant parse of the same columns matches those student, sex, race, IDEA, school, and LEA totals. The script skips schools with no positive student total, which leaves out 42 positive instance values. Adding those 42 makes 28,310 positive values in `SCH_CORPINSTANCES_WODIS` and `SCH_CORPINSTANCES_WDIS`.

Sex, from the same total columns, among the 19,851: boys 16,144, girls 3,707, nonbinary 0. Race, from `SCH_DISCWODIS_CORP_{HI,AM,AS,HP,BL,WH,TR}_{M,F,X}` plus the matching `SCH_DISCWDIS_CORP_IDEA_*` columns: Hispanic 2,547; American Indian or Alaska Native 384; Asian 58; Native Hawaiian or Other Pacific Islander 21; Black 5,266; White 10,840; two or more races 735. Those seven race counts sum to 19,851. Without disabilities 16,466; IDEA 3,385.

`SCH_DISCWDIS_CORP_504_{M,F,X}` sums to 957 across every school. `extract.mjs` does not add that column to the student total. 941 of the 957 are at schools already counted in the 19,851, and 16 are at schools with no positive value in the total columns above. 1,752 schools have `SCH_CORP_IND` equal to Yes. 1,611 schools have -5 in at least one of `TOT_DISCWODIS_CORP_{M,F,X}` or `TOT_DISCWDIS_CORP_IDEA_{M,F,X}`, 1,606 of them in New York. This CSV has no preschool corporal-punishment column. The nonbinary columns are present and sum to 0.

Known error: New Jersey, a ban state, shows 380 students and 1,655 instances, all from three Salem City School District schools (NCES LEA 3414550). Excluding it, the national total is 19,471. Other ban-state counts in this recompute: NY 14, WA 12, MI 5, MN 4, CA 3. Treat any ban-state district in `districts.csv` as a reporting error until checked.

## Files

`national.csv`, `states.csv`, and `districts.csv` use the script's rule: a school counts only when the student total above is positive. `districts.csv` lists all 832 LEAs and sums to 19,851. `states.csv` lists all 19 states with a positive total, including the states under 50 students. `per_1000_enrolled` is blank because this refresh did not recompute enrollment rates. `section_504` is the 504-column sum at schools included in the student total, not a second student total.

Regenerate the script JSON with `node tools/crdc/extract.mjs "<SCH/Corporal Punishment.csv>"`.
