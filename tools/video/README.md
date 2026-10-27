# Narrated video from a Slides-type deck

Pipeline used for the Texas inservice (2026-10-13):

1. `render.mjs <deck/project/slides> <frames dir>` renders every slide to PNG at 1920x1080 with Playwright, one frame per
   reveal state (state k shows the first k children of the slide's content wrapper). Fonts: Carlito (Calibri twin) from
   `fonts/`. Edit the `S` constant for paths.
2. `script.json` holds the narration: per slide, segments of `{after: <reveal state>, text}`. Voice via fal
   `fal-ai/elevenlabs/tts/multilingual-v2` (voice "Brian"), one mp3 per segment in `tts/`, durations in `tts/durations.json`.
3. `assemble.py` cuts it: one clip per segment (slow zoompan on the state frame), 0.5 s crossfade between reveals,
   0.8 s between slides, narration delayed onto its clip, mixed to one track. ffmpeg 7 syntax (`-/filter_complex`).

Outputs for Texas: `out/video/texas/` (deck files, cover photo, mp4).
