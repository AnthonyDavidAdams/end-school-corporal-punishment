"""Cut the film: each scene's clip is stretched (slowed) to its narration length, the narration sits 0.5 s in,
scenes dissolve into each other, a piano bed runs underneath with ducking, film-grain look stays as rendered.
Image scenes use the Kling clip slowed to fit; motion scenes were rendered to the exact length already."""
import json, subprocess, os
FPS = 30; XF = 0.9; LEAD = 0.5; TAIL = 0.9
sc = json.load(open("script.json")); dur = json.load(open("tts/durations.json"))
scenes = []
for s in sc["scenes"]:
    T = dur[s["id"]] + LEAD + TAIL
    if s["kind"] == "image":
        src = f"clips/{s['image']}.mp4"
    else:
        src = f"clips/{s['id']}.mp4"
    scenes.append({"id": s["id"], "src": src, "T": T, "kind": s["kind"]})
# timeline with overlaps
t = 0.0; starts = []
for k, s in enumerate(scenes):
    if k > 0: t -= XF
    starts.append(t); t += s["T"]
total = t
args = ["ffmpeg", "-y", "-loglevel", "warning", "-stats"]
for s in scenes: args += ["-i", s["src"]]
for s in scenes: args += ["-i", f"tts/{s['id']}.mp3"]
args += ["-stream_loop", "-1", "-i", "music/bed.wav"]
n = len(scenes); f = []
# overlay png sequences (rendered by render-motion.mjs in overlay mode) are extra inputs after the music
ovl = {}
for s in scenes:
    d = f"overlays/{s['id']}"
    if s["kind"] == "image" and os.path.isdir(d) and os.listdir(d):
        ovl[s["id"]] = 2 * n + 1 + len(ovl); args += ["-framerate", str(FPS), "-i", f"{d}/%05d.png"]
for k, s in enumerate(scenes):
    src_len = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", s["src"]], capture_output=True, text=True).stdout)
    if s["kind"] == "image":
        # slow the clip so it lasts T (never faster than real time); if even slowed it is short, hold the last frame
        factor = max(1.0, s["T"] / src_len)
        base = f"[{k}:v]setpts={factor:.4f}*PTS,fps={FPS},scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,tpad=stop_mode=clone:stop_duration=3,trim=duration={s['T']:.3f},setpts=PTS-STARTPTS,format=yuv420p,setsar=1"
        if s["id"] in ovl:
            f.append(base + f"[b{k}]"); f.append(f"[{ovl[s['id']]}:v]format=rgba,setpts=PTS-STARTPTS[o{k}]"); f.append(f"[b{k}][o{k}]overlay=0:0:format=auto,format=yuv420p[v{k}]")
        else:
            f.append(base + f"[v{k}]")
    else:
        f.append(f"[{k}:v]fps={FPS},trim=duration={s['T']:.3f},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v{k}]")
prev = "v0"
for k in range(1, n):
    out = f"x{k}" if k < n - 1 else "vfade"
    f.append(f"[{prev}][v{k}]xfade=transition=fade:duration={XF}:offset={starts[k]:.3f}[{out}]"); prev = out
f.append(f"[vfade]fade=t=in:st=0:d=1.2,fade=t=out:st={total-1.5:.3f}:d=1.5,scale=in_range=full:out_range=tv,format=yuv420p[vout]")
for k, s in enumerate(scenes):
    ms = int((starts[k] + LEAD) * 1000)
    f.append(f"[{n+k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[a{k}]")
f.append("".join(f"[a{k}]" for k in range(n)) + f"amix=inputs={n}:normalize=0:dropout_transition=0[vo]")
f.append(f"[{2*n}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration={total:.3f},volume=0.16,afade=t=in:st=0:d=3,afade=t=out:st={total-6:.3f}:d=6[bed]")
f.append("[vo]asplit=2[vo1][vo2]")
f.append("[bed][vo2]sidechaincompress=threshold=0.05:ratio=4:attack=60:release=800[bedduck]")
f.append("[bedduck][vo1]amix=inputs=2:normalize=0:dropout_transition=0,alimiter=limit=0.95[aout]")
open("filter.txt", "w").write(";\n".join(f))
out = "one-sentence.mp4"
args += ["-/filter_complex", "filter.txt", "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
         "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",   # jpeg frames are full-range; QuickTime shows pc-range H.264 as black
         "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", f"{total:.3f}", out]
print(f"{n} scenes, {total/60:.1f} min")
subprocess.run(args, check=True)
print("wrote", out, os.path.getsize(out) // 1_000_000, "MB")
