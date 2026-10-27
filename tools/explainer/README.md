# The explainer: "Two girls, one sentence", one edition per state

The method is the "Make a Hand-Drawn Explainer Video with Claude" guide (style reference, script, a still per scene,
image-to-video with each clip morphing into the next, Remotion edit with word-by-word subtitles), with fal in place
of Higgsfield: Flux stills with a Kontext lettering-removal pass, Seedance 2.5 image-to-video with the next still as
the end frame, ElevenLabs narration, Whisper word timestamps, Remotion. The look is in STYLE.md (paper collage).

The story is Ava and Emma from the first film: same town, same Tuesday, two policies. It opens on Ava grown,
remembering (a composite drawn from the published accounts in `facts/claims/testimony-first-hand-accounts.md`, and
labeled as one on screen); the state's numbers are the side story, shown as paper strips and typewriter cards;
the close speaks to the audience's own identity, people who believe children can change and that evidence should
change us, and asks for one vote.

    python3 tools/explainer/make.py all --state GA            # the whole pipeline, cached per file
    python3 tools/explainer/make.py fill --state GA           # just the script, to read it
    python3 tools/explainer/make.py render --state GA --vertical --draft

Per edition only the words change: `script.json` has `{slots}` that `fill` resolves from the same sources as the
state board page (CRDC, model-language.json, the record, policy-lag.json). Scenes with no data for a state are
dropped (`skip_if`). Stills, clips and narration are cached in `out/explainer/<ST>/`; delete a file to redo it.
Scenes that do not mention the state (the witness, the two girls, the research, the identity line) could be shared
across editions by copying their files between state folders.

Cost per edition, 720p: 11 stills (about $1.10 with the Kontext pass), 11 Seedance clips (confirm on the first;
the fal dashboard shows it), narration and Whisper under $1. 1080p clips cost more; `--res 1080p`.

Your own voice: record each scene as `<scene id>.mp3`, then `make.py voice --state GA --voice-dir <folder>`.
