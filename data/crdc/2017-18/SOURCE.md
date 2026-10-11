# 2017-18 CRDC extract

Downloaded 2026-10-05 from https://civilrightsdata.ed.gov/assets/ocr/docs/2017-18-crdc-data.zip (HTTP 200, 119,899,863 bytes).

- SHA-256 of the zip: `422d5cef8733c0d3084cb16e5ad4f459e38de943d3cd5118bc60c93d1e27511a`
- File inside the zip: `2017-18-crdc-data-corrected-publication 2/2017-18 Public-Use Files/Data/SCH/CRDC/CSV/Corporal Punishment.csv` (zip entry dated 2021-05-24, 28,761,210 bytes uncompressed)
- SHA-256 of that CSV: `e4ae3686d1f6862d244a2d2a89672756957b3d2e5ecf1b3c6e999adbbd3e9cb1`
- 97,632 school rows and 17,604 LEAs in the CSV

`tools/crdc/extract.mjs` sums `TOT_DISCWODIS_CORP_{M,F}` and `TOT_DISCWDIS_CORP_IDEA_{M,F}` and treats negative reserve codes as zero. On this file that script returns 67,714 students, 96,401 instances, 54,771 boys, 25,229 Black, 11,459 IDEA, 3,548 schools, and 1,340 LEAs.

`SCH_DISCWDIS_CORP_504_{M,F}` sums to 1,778 (1,552 boys and 226 girls). Adding those students to the script total gives 69,492. Adding the 1,552 boys gives 56,323. The same addition, state by state, reproduces the student counts that were already in `states.csv`. The CSVs in this folder use that sum: without disabilities 56,255, IDEA 11,459, Section 504 1,778. This file has no nonbinary corporal-punishment columns.

Sex among the 69,492: boys 56,323, girls 13,169. Race columns cover the 67,714 students in the script total and do not break down the 1,778 Section 504 students: Hispanic 5,314; American Indian or Alaska Native 1,300; Asian 109; Native Hawaiian or Other Pacific Islander 48; Black 25,229; White 34,157; two or more races 1,557.

Instances at schools with a positive student count in those three groups: 96,417. Another 464 positive instance values are at schools whose student totals are not positive. `SCH_CORPINSTANCES_IND` is Yes at 4,137 schools, No at 93,477, -5 at 10, and -6 at 8. Schools with at least one student in the three groups: 3,558. LEAs: 1,341.

Preschool is separate and is not in the 69,492. `TOT_PSDISC_CORP_{M,F}` sums to 856. `SCH_PSCORPINSTANCES_ALL` sums to 1,500. `SCH_PSDISC_CORP_IDEA_{M,F}` sums to 87.

`per_1000_enrolled` is blank. This run did not recompute enrollment rates.

Ban-state counts in this recompute, from the same student total: Illinois 202, District of Columbia 35, Wisconsin 26, New York 5, Nevada 1, Washington 1. Treat a ban-state count as a reporting error until checked.

## Files

`national.csv`, `states.csv`, and `districts.csv` count a student when any of the without-disability, IDEA, or Section 504 totals above is positive. `districts.csv` lists 1,341 LEAs and sums to 69,492. `states.csv` lists 22 states. `section_504` is the 504-column sum and is already included in `students`.

The script JSON, which omits Section 504, is `node tools/crdc/extract.mjs "<Corporal Punishment.csv>"`.
