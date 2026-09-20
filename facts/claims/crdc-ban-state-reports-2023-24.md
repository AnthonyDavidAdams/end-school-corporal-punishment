---
id: crdc-ban-state-reports-2023-24
claim: "In the 2023-24 Civil Rights Data Collection, 19 school districts in states that prohibit corporal punishment reported students struck, totalling 418 students; 380 of those come from one New Jersey district whose ratio of instances to students, 4.4, is roughly three times that of any state where corporal punishment is lawful."
status: verified
figure: 418
as_of: "2023-24"
sources:
  - url: https://civilrightsdata.ed.gov/assets/ocr/docs/2023-24-crdc-data.zip
    title: "2023-24 Civil Rights Data Collection, SCH/Corporal Punishment.csv"
    publisher: "US Department of Education, Office for Civil Rights"
    date: "2026-08-06"
    primary: true
tags: [crdc, caveat, computed, ban-states]
last_verified: 2026-09-20
verified_by: "agent:claude (computed from the public-use file)"
---

Computed by this project from the same file as the national figure; see `data/crdc/2023-24/SOURCE.md`.

## Why these numbers are almost certainly not corporal punishment

**One district is 91% of it.** Salem City School District, New Jersey, reports 380 students and 1,655
instances across three schools. New Jersey has prohibited corporal punishment in its schools since
1867, the first state to do so.

**The ratio is wrong for paddling.** Instances per student in the states where corporal punishment is
lawful sit in a narrow band: Texas 1.6, Arkansas 1.4, Alabama 1.2, Mississippi 1.2. A paddled student
is typically paddled once or twice in a year. Salem City reports 4.4 instances per student, about
three times the highest lawful-state figure.

**The disability share is wrong too.** 89 of Salem City's 380 students, 23%, are students with
disabilities. In Mississippi the figure is 22 of 2,653, under 1%. A rate that far out of line is the
signature of a different practice being entered in this field.

Both patterns fit physical restraint or seclusion rather than corporal punishment: a small number of
students, each involved in repeated incidents, concentrated among students with disabilities. The CRDC
collects restraint and seclusion separately, and a district that files them in the wrong column
produces exactly this shape.

## The other eighteen

The remaining 38 students are spread across 18 districts and 14 of them report one or two students,
which is the ordinary single-cell noise of a collection this size. Three are not ordinary districts at
all but regional service agencies serving students with disabilities across member districts:
Northwest Educational Service District 189 in Washington, and two New York BOCES. That is again where
restraint and seclusion happen.

## What follows from this

The national total of 19,851 should be read as 19,471 in the states where the practice is lawful, plus
380 from one filing that does not behave like corporal punishment. Neither figure is corrected here:
the raw number is what the district filed and this project does not edit federal data. It is flagged,
and any ban-state district in `districts.csv` should be treated as a reporting question rather than a
scanning target until someone has asked the district what it filed.

None of this is a finding about what happened to any child in Salem City. It is a finding about a
number in a spreadsheet, and the way to resolve it is to ask the district, which nobody has yet.

## History
- 2026-09-20: created.
