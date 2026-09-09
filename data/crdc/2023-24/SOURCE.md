# 2023-24 CRDC extract (project computation)

The Office for Civil Rights released the 2023-24 public-use file on August 31, 2026 with no First Look report and no estimations-tool year, so there is no official corporal punishment figure for 2023-24. These numbers were computed by this project from `SCH/Corporal Punishment.csv` in https://civilrightsdata.ed.gov/assets/ocr/docs/2023-24-crdc-data.zip (file dated 2026-08-06; 97,094 school rows; 17,591 LEAs).

Method: national total = sum of `TOT_DISCWODIS_CORP_{M,F,X}` + `TOT_DISCWDIS_CORP_IDEA_{M,F,X}`, negative reserve codes treated as zero. The identical method reproduces the official 2021-22 figures exactly (24,534 students; 19,910 boys; 6,438 Black; 16 states).

Results: 19,851 students (16,466 without disabilities, 3,385 with, of whom 957 were 504-only); 28,310 instances; boys 16,144 (81.3%); Black 5,266 (26.5% vs 14.7% of enrollment); 1,738 schools and 832 LEAs with at least one student; 1,752 schools answering Yes to `SCH_CORP_IND`.

Known error: New Jersey, a ban state, shows 380 students and 1,655 instances, all from three Salem City School District schools. Excluding it, the national total is 19,471. Other ban-state noise: NY 14, WA 12, MI 5, MN 4, CA 3. 1,611 schools (1,606 in New York) carry the -5 missing-data code.

Changes in this collection: preschool corporal punishment instances removed; nonbinary fields suppressed. Re-run `tools/crdc/extract.mjs` against the file and replace this note with the script output and a SHA-256 when the `crdc-refresh` task is executed; retire the computed claim when OCR publishes its own figure.
