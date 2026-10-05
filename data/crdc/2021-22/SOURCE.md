# 2021-22 CRDC extract

Downloaded 2026-10-05 from https://civilrightsdata.ed.gov/assets/ocr/docs/2021-22-crdc-data.zip (HTTP 200, 832,409,504 bytes).

- SHA-256 of the zip: `5d0b6b2996f06d5ea1ee4fd94b4d6687b9fcd3efaac7e8b0b65533f82765fd4f`
- File inside the zip: `SCH/Corporal Punishment.csv` (zip entry dated 2025-01-10, 29,359,747 bytes uncompressed)
- SHA-256 of that CSV: `0795c10216d1fb5a1b00f53a43bcc63ec2886cb0bd1b3036f4f38b1a9a09b6ca`
- 98,010 school rows and 17,704 LEAs in the CSV

Recomputed in this repository on 2026-10-05 with `tools/crdc/extract.mjs`. Negative reserve codes are treated as zero. The student total is the sum of `TOT_DISCWODIS_CORP_{M,F}` and `TOT_DISCWDIS_CORP_IDEA_{M,F}`. This file has no nonbinary (`_X`) corporal-punishment columns.

Script output: 24,534 students; 31,732 instances; boys 19,910; Black 6,438; with disabilities (IDEA columns) 3,772; 2,050 schools; 948 LEAs. A standards-compliant parse of the same columns matches those totals. The script skips schools with no positive student total, which leaves out 47 positive instance values. Adding those 47 makes 31,779 positive values in `SCH_CORPINSTANCES_WODIS` and `SCH_CORPINSTANCES_WDIS`.

The same 24,534 is the sum of two OCR estimations API responses opened this run: https://civilrightsdata.ed.gov/api/v1.0/GetNationalEstimation?survey_Year_Key=11&Measure_Id=75 (`b_Count` 20,762, Non-IDEA) and https://civilrightsdata.ed.gov/api/v1.0/GetNationalEstimation?survey_Year_Key=11&Measure_Id=66 (`b_Count` 3,772, IDEA). Boys 16,669 + 3,241 = 19,910. Girls 4,093 + 531 = 4,624. Black 5,576 + 862 = 6,438. Those API sums match the zip extract. Each API response reports `participatedSchools` 2,476. The CSV has `SCH_CORP_IND` equal to Yes on 2,478 schools. Both figures are recorded; they are not the same count.

Sex among the 24,534: boys 19,910, girls 4,624. Race from `SCH_DISCWODIS_CORP_{HI,AM,AS,HP,BL,WH,TR}_{M,F}` plus the matching IDEA columns: Hispanic 2,890; American Indian or Alaska Native 465; Asian 61; Native Hawaiian or Other Pacific Islander 22; Black 6,438; White 13,785; two or more races 873. Those seven race counts sum to 24,534. Without disabilities 20,762; IDEA 3,772.

`SCH_DISCWDIS_CORP_504_{M,F}` sums to 940. `extract.mjs` does not add that column to the student total. 928 of the 940 are at schools already counted in the 24,534.

Preschool is a separate set of columns and is not in the 24,534. `TOT_PSDISC_CORP_{M,F}` sums to 500 students at 189 schools. `SCH_PSCORPINSTANCES_ALL` sums to 932. `SCH_PSDISC_CORP_IDEA_{M,F}` sums to 67. `SCH_PSCORPINSTANCES_IDEA` sums to 142. `SCH_PSCORP_IND` is Yes at 237 schools.

`per_1000_enrolled` is blank. The previous state file's rates were taken from the estimations API on 2026-09-09. The national estimation response opened this run has `nDenominator` null, so those rates were not recomputed.

16 states have a positive K-12 student total. The state student, Black, boy, and IDEA counts in `states.csv` match the previous state file's counts for every state that file listed.

## Files

`national.csv`, `states.csv`, and `districts.csv` use the script's rule: a school counts only when the K-12 student total above is positive. `districts.csv` lists all 948 LEAs and sums to 24,534. `section_504` on the state file is the 504-column sum at schools included in that student total.

Regenerate the script JSON with `node tools/crdc/extract.mjs "<SCH/Corporal Punishment.csv>"`.
