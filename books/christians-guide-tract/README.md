# A Christian's Guide to Corporal Punishment (tract edition)

The KDP paperback of `kit/a-christians-guide.md`: four by six inches, thirty-two pages, black ink on cream, a cartoon facing every idea. See `00-concept/structure.md` for the page map, `SOURCES.md` for the claim behind every sentence, `panels.md` for the drawings, `listing.yaml` (also `kdp.yaml`) for the Amazon listing.

Build the interior, the cover, and check the sources:

    ~/.kdp-venv/bin/python ~/book-suite/plugins/imprint/skills/build-kdp-pdf/build.py .
    ~/.fal-venv/bin/python ~/book-suite/plugins/imprint/skills/kdp-cover/build_cover.py . --art build/cover/front-art.png
    tools/check_sources.sh

Generate the drawings (fal.ai, paid; see the estimate in `panels.md`):

    ~/.fal-venv/bin/python tools/panels.py sheet
    ~/.fal-venv/bin/python tools/panels.py panels
    ~/.fal-venv/bin/python tools/panels.py cover
