# One Sentence, Remotion build (v3)

- `src/Film.tsx` lays scenes out from `public/data.json` (built from `tools/film/script-v3.json` + narration durations + Whisper word timestamps): T = narration + 0.5 s lead + 0.9 s tail, 0.6 s crossfades, music bed ducked under speech.
- `src/clipscenes.tsx`: Kling clips slowed to the narration with a micro push-in; kinetic lower-third captions land on the narrator's phrases (`src/captions.tsx`); the split-screen "Ava and Emma" scenes.
- `src/scenes.tsx`: counter, statute, bars, pictogram, three words, the sentence, close, each cued to word timestamps.
- Media is not in git: copy `out/video/one-sentence/{clips,img,v3/tts}` and `music/bed.wav`, `fonts/Carlito-*.ttf` into `public/`.
- Render: `npx remotion render src/index.ts OneSentence out.mp4 --crf 18` (draft: `--scale 0.5 --crf 24 --x264-preset veryfast`).
- House rules distilled from the 30x-video and claude-video-studio skills: `tools/film/rules.md`.
