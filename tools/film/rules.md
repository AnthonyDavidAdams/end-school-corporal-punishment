# One Sentence: film rules

Under `/private/tmp/claude-501/-Users-anthony/bbf1be70-efdc-46e2-a99b-280c9f858c0e/scratchpad/skills/`: `30x/` = `30x-video/skills/30x-web-to-video/`, `studio/` = `claude-video-studio/`.

## 1. Rules that apply to a documentary

**Blacklist**
1. No expanding rings, heartbeat throb, decorative rules, dingbat rows, emoji, gradient text, glow, particles, light leaks, spins, glitches, bounce on type (30x rules/taste.md; studio CLAUDE.md).
2. No headline over a full-bleed Kling still; type goes in its empty zone or the shot is textless (30x rules/taste.md).
3. No hero-metric template (big number + small label), hollow three-card triptych, or small object centered in a void (30x rules/data-viz.md, composition.md).
4. Max three text blocks per frame; what the narration says is never repeated as small type (30x rules/typography.md).

**Composition**
5. One focal point per frame, winning by two of size, contrast, position, weight; title-safe 96px inset, bottom 15% captions only (30x rules/taste.md, layout.md).
6. Never a flat solid behind content: vignette and grain over the navy, light with a source and direction (30x rules/composition.md Law 1).
7. Each act gets one full-bleed moment; foreground under 60% of frame with dead margins means redesign (composition.md Law 2).
8. Adjacent scenes never share a skeleton; composition varies, palette and type stay locked (composition.md Law 5).

**Motion**
9. Entrance 15-20f ease-out-expo, hold 60-120f, exit 10-15f; springs damping 14-16; never linear, never bounce; one focal animation at a time; transform and opacity only (30x rules/motion.md).
10. Hold-then-snap: still 60-90f, change in 8-12f; no hold over 4s without a 1.00-1.04 micro push (motion.md; studio CLAUDE.md).
11. Enters rise through a mask or grow from a source (scale 0.85 to 1, opacity in 4 frames or fewer); a pure fade is never an enter or exit, except small sub-lines (studio CLAUDE.md, src/motion/text.tsx).
12. Headlines: heavy no-overshoot spring (0.5s, damping 1.0); camera pushes 1.3-1.6s, a fast push reads as a jump cut (studio .claude/skills/promo-video/reference/motion.md).
13. Every animation finishes 45f before the exit starts; any text-bearing sequence is at least 80f (motion.md iron law).

**Typography**
14. Weights 300-600 only; Carlito in two or three weights; negative tracking on headlines, positive on uppercase labels; tabular-nums on counters (30x rules/typography.md, data-viz.md).
15. At 1920x1080: hero 80, metric 96, sub 36, body 28, caption 20 floor; one editorial word per act may go 200-320px; studio floor: headline 84px, must-read 44px, legible at 360px wide (typography.md; composition.md; studio CLAUDE.md).

**Narration sync**
16. Beat-lock: every cut, reveal and count-up start traces to an ElevenLabs timestamp, never an even split (30x rules/narration-sync.md Rule 1).
17. Cuts land on sentence ends plus about 300ms, never mid-word; music beats yield to the sentence gap; confirm with silencedetect (Rule 3).
18. One continuous take per argument; visuals snap to phrase onsets, never pad audio; hits start frames early to read on the word (Rule 4; studio `hitStart`, src/motion/timeline.tsx).

**Data viz**
19. Bars grow width 0 to full, damping 200, 10f stagger; counters floor a spring-driven interpolate; one number per beat, full-screen, never a row of count-ups (data-viz.md; composition.md).
20. Item count dictates layout: two is a confrontation (our split screen), three thirds, four one unboxed row; comparisons are a long dim baseline bar against a short bright one (composition.md).

**Transitions, color, finish**
21. Narrated documentary: 12-20f crossfades between scenes, hard cuts only on a true stop or inside the split screen; the studio's crossfade ban is for promos (30x rules/transitions.md, beat-sync.md).
22. 60-30-10; one vibrant accent per scene at three opacities (full, 15-20%, 5-8%); navy-tinted neutrals, no pure black or white in large areas; orange means harm, light blue the other outcome, never swapped (30x rules/color.md).
23. 2-4% fixed-seed grain, vignette 0.3-0.5 last, saturation 0.85-0.9 (30x rules/cinematic.md).
24. Evidence not grep: every act gets a rendered still actually Read; delivery ends with "What I did NOT verify" (30x rules/qc-gates.md).

## 2. Frame-critic checklist (studio .claude/agents/frame-critic.md)

Score 1-10 with timecode cited; SHIP only when every score is 8 or more; a problem still visible from last round cannot score higher.
1. Hook: frame 0 not empty, hook reads by 2s (empty frame 0 caps 6).
2. Readability: every must-read word legible at 360px; illegible CTA or accent text on accent ground caps 6.
3. Motion: a fade as enter, exit or transition caps 6; a jump in a 12-frame strip caps 7.
4. Pacing: maxGapSec over 4 caps 7; a hold past one bar without motion caps 7 (documentary: allow 6s with a micro push).
5. Accuracy: wrong font, second accent, invented UI caps 6; a claim outside the verified facts caps 4.
6. Sound sync: visual onset outside -200/+60ms of its cue, loudness off -14 LUFS by over 1, or peak above -1 dBTP caps 6.
7. Composition: one focal point; a third of the frame empty over 1s caps 7.
8. Polish: blank frame, double-exposed caption, glyph sliver at a mask edge, lingering caret caps 7.
9. Name the three worst problems with testable fixes; fix only those, re-render, commit; read sheets first, six key frames max, no source code.

## 3. Techniques worth copying

- **Parallax and Ken Burns on stills:** scale 1.0 to 1.08 plus 20-40px drift, ease-out quad; layers at 0.3x, 1x, 1.5x (30x rules/cinematic.md, transitions.md; scaffold/src/MainVideo.tsx `Act2Reveal`). Kling clips already move; micro push only.
- **Kinetic captions from word timestamps:** `WordCaptions` paginates by maxChars, page enters on first-word start, exits at last-word end (30x scaffold/src/components/Captions.tsx). Character alignment to words: `words_from_alignment` (studio tools/vo.py). SRT chunks of 4 words or 1.6s (studio tools/finish.py). Mask-rise headline with accent words: `RiseText` (studio src/motion/text.tsx).
- **Timing model:** closed-form springs as pure functions of seconds, so 30fps drafts match 60fps finals (studio src/motion/spring.ts); `useTimeline()` `hit`/`hitStart`/`span` and `<Shot pre post>` in absolute time (studio src/motion/timeline.tsx, src/kit/Stage.tsx). Swap beat marks for phrase onsets.
- **Beat detection:** comb-search grid, downbeats by low-frequency energy, p90 residual under 15ms (studio tools/beats.py). For the piano bed run 30x scripts/analyze-audiomap.py; on `rhythmic: false` cut on `energy_phases` and `silences`, not the grid (30x rules/beat-sync.md).
- **Contact sheets and metrics:** 2fps contact grid, 360px phone sheet per shot key frame, 12-frame strips at the fastest moments, blank/static/maxGap/cue-sync metrics from frame diffs (studio tools/review.py); per-shot stills and animatic (studio tools/storyboard.mjs); black, freeze, silence detection (30x scripts/render-qa.ts).
- **Remotion layout:** one composition per format, `calculateMetadata` switching fps 30/60 on a `draft` prop (studio src/Root.tsx); per-video folder: brief, script, shotlist, timeline.json, scenes/*.tsx (studio CLAUDE.md). Packages: remotion, @remotion/cli, media, motion-blur, transitions, captions, fonts (studio package.json); @remotion/paths for bars (30x scaffold/package.json). Grain: studio src/kit/Grain.tsx; digit roll: src/motion/counter.tsx.
- **Render:** draft h264 crf 22 veryfast 30fps; final 60fps, crf 14, preset slow, PNG frames, yuv420p, bt709; `CameraMotionBlur` 180 degrees, 10 samples, foreground only (studio tools/render.sh, src/kit/Stage.tsx).
- **Audio:** music ducked 9dB under words, 60ms attack, 280ms release; master -14 LUFS, -1 dBTP, AAC 320k (studio tools/mix.py, finish.py). Cinematic bed: loudnorm I=-18 LRA=11 TP=-2; full level 85% of runtime, fade only in the last 1.5s (30x rules/workflow.md).

## 4. Skip these

1. Brand scraping and URL-to-video orchestration (30x rules/workflow.md, scripts/url-to-video.ts).
2. Product UI mockups, phone frames, kanban/terminal templates, app component porting (30x rules/ui-mockups.md, cards.md; studio src/kit/app/).
3. Logo-entrance variants, shimmer sweeps, whip-pan and glitch transitions (30x rules/cinematic.md, scaffold Transitions.tsx).
4. Beat-grid timeline, synthesized SFX, ACE-Step music, 9:16 safe zones; our clock is the narration (studio timeline.json, tools/sfx.py, src/motion/format.ts).
5. Five-act launch structure, archetype dials, claims-table-from-codebase (30x rules/narrative.md, archetypes.md; studio brand/brand.md).
