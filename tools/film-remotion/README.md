# One Sentence, Remotion build (v3)

- `src/Film.tsx` lays scenes out from `public/data.json` (built from `tools/film/script-v3.json` + narration durations + Whisper word timestamps): T = narration + 0.5 s lead + 0.9 s tail, 0.6 s crossfades, music bed ducked under speech.
- `src/clipscenes.tsx`: Kling clips slowed to the narration with a micro push-in; kinetic lower-third captions land on the narrator's phrases (`src/captions.tsx`); the split-screen "Ava and Emma" scenes.
- `src/scenes.tsx`: counter, statute, bars, pictogram, three words, the sentence, close, each cued to word timestamps.
- Media is not in git: copy `out/video/one-sentence/{clips,img,v3/tts}` and `music/bed.wav`, `fonts/Carlito-*.ttf` into `public/`.
- Render: `npx remotion render src/index.ts OneSentence out.mp4 --crf 18` (draft: `--scale 0.5 --crf 24 --x264-preset veryfast`).
- National edition: composition `OneSentenceNational` from `public/data-national.json` and `public/tts-national/`, both staged by `tools/film/national.py stage`; the motion scenes take their figures from `scene.fig` and timing phrases from `scene.cues`.
- National edition v5 (2026-10-28): every line voiced on ElevenLabs v3 (`national.py voice --yes --all`); a scene may carry `tail` to hold longer after its narration (the pictogram does); the words scene fills the frame with the 2016 open letter's signatories (`fig.names`, `fig.stage`) after the three words; the close takes a `fig.lede`; the opening paddle is `paddle_v5` (Kling from `paddle-c1.jpg`).
- House rules distilled from the 30x-video and claude-video-studio skills: `tools/film/rules.md`.
