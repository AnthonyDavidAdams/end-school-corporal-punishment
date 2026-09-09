# 2021-22 CRDC extract

- National total and breakdowns: OCR "2021-22 CRDC: A First Look" (January 2025), https://www.ed.gov/media/document/2021-22-crdc-first-look-report-109194.pdf
- State table: OCR State and National Estimations API, measures 75 (non-IDEA students, corporal punishment) and 66 (students with disabilities, corporal punishment), field `b_Count`; per-1,000 rates use the API `DataSpotlight` state enrollment. Retrieved 2026-09-09. The 52 jurisdictions sum exactly to 24,534.
- Schools and districts (2,050 schools; 948 LEAs; 31,779 instances): computed from `SCH/Corporal Punishment.csv` in https://civilrightsdata.ed.gov/assets/ocr/docs/2021-22-crdc-data.zip. Not yet re-run inside this repository; see `tools/crdc/extract.mjs`.
- 19 states reported zero; 17 jurisdictions carry the -9 "not applicable" code (mostly ban states). Zero and "not asked" are different sets.
