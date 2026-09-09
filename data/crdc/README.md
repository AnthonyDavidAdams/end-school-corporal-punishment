# Civil Rights Data Collection extracts

The US Department of Education's Civil Rights Data Collection (CRDC) surveys every public school in the country, most recently every two years, and includes the number of students who received corporal punishment, broken down by sex, race, disability status, and English-learner status. It is the only national count and it is public domain.

- Portal: https://civilrightsdata.ed.gov/
- Data download (school-level files, one per release): https://civilrightsdata.ed.gov/data
- Interactive estimations and state/district profiles: https://civilrightsdata.ed.gov/estimations

Each subfolder is one release year and holds `SOURCE.md` (exact file, download date, SHA-256), `national.csv`, `states.csv`, `districts.csv`. Produced by the `crdc-refresh` task; the extraction script lives in `tools/crdc/`.

Known caveats to repeat whenever a number is quoted:

- CRDC counts **students** who received corporal punishment at least once, not incidents. Instances are higher.
- Districts self-report. Undercounting is documented; a school that paddles and reports zero does not appear anywhere.
- The 2020-21 release covers a pandemic year with most students remote for part of it and is not comparable to earlier years.
- Column names change between releases. Check `SOURCE.md` before joining years.
