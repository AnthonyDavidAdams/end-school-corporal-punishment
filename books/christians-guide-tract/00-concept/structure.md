# Structure

**Trim:** 4 x 6 in (KDP custom trim; the smallest it prints). **Pages:** 32 (KDP minimum 24; no spine text under about eighty pages). **Interior:** black ink, cream paper, no bleed. **Margins:** inside 0.5, outside 0.375, top 0.45, bottom 0.5 (KDP requires 0.375 inside and 0.25 outside at this page count).

**Type:** EB Garamond 10 on 12 for the body, 13 pt bold headings, 9 pt italic reference line, 6.8 pt registry line at the foot. Plain folio at the foot of text pages; cartoon pages carry none.

**The spread is the unit.** Each spread file opens on a left-hand page (`chapters_open: left` in book.yaml, `\panelPage` in the preamble override) with one cartoon filling the type block, and its words on the facing right-hand page: the verse or the finding as the heading, the reference beneath it, one or two paragraphs, and the ids of the verified claims at the foot.

| Page | Content |
|---|---|
| 1 | Title page |
| 2 | Copyright page (CC BY 4.0 notice, publisher, place, LCCN line when assigned) |
| 3 | Who this is for |
| 4-5 | Why a minister is writing this |
| 6-7 | Teaching them to observe all things (Matthew 28:19-20; Proverbs 22:6) |
| 8-9 | Provoke not your children to wrath (Ephesians 6:4) |
| 10-11 | Afterward it yieldeth the peaceable fruit (Hebrews 12:11) |
| 12-13 | He that spareth his rod (the five rod passages) |
| 14-15 | His son. Thy son. (addressed to parents, not schools) |
| 16-17 | Ye shall know them by their fruits (the 2016 meta-analysis) |
| 18-19 | The thing we tell ourselves paddling is for (the 2022 school meta-analysis) |
| 20-21 | Lest they be discouraged (the 2019 matched study; Colossians; Galatians) |
| 22-23 | Prove all things (no study of benefit; the AAP) |
| 24-25 | Chasteneth him betimes (the teacher's work; 54 studies; Maryland trial) |
| 26-27 | Same scripture. Different board. (what the churches have said) |
| 28-29 | The Board prohibits the use of corporal punishment in the District. |
| 30-31 | A page to read aloud (the booklet's 396-word page, whole) |
| 32 | Passages cited, in order; the registry and the kit URL |

**Build:** `~/.kdp-venv/bin/python ~/book-suite/plugins/imprint/skills/build-kdp-pdf/build.py .` with the per-book `build/preamble.tex.j2` (no half-title, no running heads, the `\panelPage`, `\spreadHead`, `\spreadSource` macros and the `passages` list). Output `build/dist/a-christians-guide-tract.pdf`; copies in `04-export/`.
