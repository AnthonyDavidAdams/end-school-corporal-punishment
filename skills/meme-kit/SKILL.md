---
name: meme-kit
description: Produce shareable images (memes, cards, flyers, one-pagers) for one audience in that audience's own visual language, using only verified facts from facts/claims/, with art generated on fal.ai and all type set locally so numbers stay exact. Use when asked for "memes", "social graphics", "a flyer for parents", "something for the church bulletin", "a one-pager for the board", or art for a specific community.
---

# Meme kit

Argument: an audience from `share/aesthetics/` (rural-parents, congregations, teachers, board-members, legislators, former-students), optionally a state or district and a format.

## Steps

1. Read `share/aesthetics/README.md` (the rules) and the audience brief. Read the verified claims you will use from `facts/claims/`; take the number, the year, and the source line from there and nowhere else. If the piece is for a state or district, take its figures from `data/crdc/` and `data/states/`.
2. Write a spec file, one JSON object per piece, following `tools/memes/example-spec.json`: audience, format, headline, sub, fact line with year, footer, and an art prompt for the background that describes an object, texture or scene in the brief's visual language and explicitly excludes people, children, text and logos.
3. Run `~/.fal-venv/bin/python tools/memes/make.py <spec.json> --out share/<audience>/`. The script generates the background with Flux (about six cents an image), sets the type with the brief's font choices using Pillow, and writes a PNG per piece plus a `manifest.md` listing the claim ids used. Add `--no-art` for typography-only pieces (free, and often better).
4. Look at every output. Reject anything with an AI tell, illegible type, or a number that does not match the claim. Regenerate with a revised art prompt or switch to `--no-art`.
5. Write `share/<audience>/README.md`: what each piece is for, where to post it, the claim ids, and the line "Made in the visual language of [audience]; from the End School Corporal Punishment project, earthpilot.org/kids."
6. Commit only the spec, the PNGs, the manifest and the README, by name. Never commit fal keys.

## Working with a real artist

If an artist from the community is available, give them the brief, the claims, and the rules, not the generated pieces; theirs will be better. Pay them from FUNDING.md and credit them on the piece if they want it.

## Lines that do not move

The rules in `share/aesthetics/README.md`: sourced numbers with years, signed pieces that impersonate nobody, no students depicted, no contempt, no emoji. A piece that breaks one is not shipped no matter how good it looks.
