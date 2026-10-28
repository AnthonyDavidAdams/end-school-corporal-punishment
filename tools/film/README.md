# "One Sentence" — the short film pipeline (2026-10-13)

1. `script.json`: scenes (image scenes animated with Kling from Flux stills; motion scenes drawn in `motion.html`),
   narration with every number spelled out in words (ElevenLabs reads digits badly), and the Flux prompts.
2. Stills: `fal-ai/flux-pro/v1.1-ultra`; lettering removed with `fal-ai/flux-pro/kontext` ("remove all lettering").
3. Hero shots: `fal-ai/kling-video/v2.5-turbo/pro/image-to-video`, locked-off prompts, cfg 0.5, 5 or 10 s.
4. Motion graphics: `motion.html` exposes `window.draw(scene, t, T)`; `render-motion.mjs` renders jpeg frames at 30 fps
   in parallel pages and encodes each scene. Edit the `F` constant for paths.
5. Voice: `fal-ai/elevenlabs/tts/multilingual-v2`, voice Brian, speed 0.95. Music: `fal-ai/stable-audio-25/text-to-audio`, 180 s piano.
6. `assemble.py`: slows each Kling clip to its narration length, crossfades, narration 0.5 s in, music bed at 0.16 with
   sidechain ducking, 1080p30 H.264 High 4:2:0.
Outputs in `out/video/one-sentence/`.

## National edition (2026-10-28)

`script-national.json` is the same fourteen scenes with the Texas facts replaced by national ones (sources listed in its
`notes`). `national.py` reuses every clip, still and the music bed from the Texas edition and re-voices only the lines that
changed (`estimate` prints the fal cost; `voice --yes` is the only step that spends). Whisper timestamps are aligned back onto
the script's own words (`align()`), so numerals in the transcript become the spelled-out numbers the scenes cue on. Scenes read
their figures from `fig` and their timing phrases from `cues` in the script; the Texas data.json carries neither and renders as
before. Output `out/video/one-sentence/one-sentence-national.mp4` is deployed as `/kids/media/one-sentence-national.mp4`
(rsync, not git) and embedded by `/kids/board/` and every non-Texas `/kids/board/<ST>/`.
