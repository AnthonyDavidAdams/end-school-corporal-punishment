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
