"""Cut the narrated video: one clip per narration segment (the slide's reveal-state frame, slow zoom), crossfades
between reveals, slightly longer crossfades between slides, narration placed on its clip, exported 1080p30.
Usage: python3 assemble.py [out.mp4]"""
import json, subprocess, sys, os
FPS = 30; XF_REVEAL = 0.5; XF_SLIDE = 0.8; LEAD = 0.5; TAIL = 0.7
sc = json.load(open("script.json")); dur = json.load(open("tts/durations.json"))
clips = []
for sl in sc["slides"]:
    for i, seg in enumerate(sl["segments"], 1):
        name = f"{sl['id']}-{i:02d}"
        clips.append({"name": name, "frame": f"frames/{sl['id']}-{seg['after']:02d}.png", "audio": f"tts/{name}.mp3",
                      "dur": dur[name] + LEAD + TAIL, "first_of_slide": i == 1})
# clip start times on the final timeline (each crossfade overlaps the previous clip's tail)
t = 0.0; starts = []
for k, c in enumerate(clips):
    if k > 0: t -= XF_SLIDE if c["first_of_slide"] else XF_REVEAL
    starts.append(t); t += c["dur"]
total = t
args = ["ffmpeg", "-y", "-loglevel", "warning", "-stats"]
for c in clips: args += ["-i", c["frame"]]   # one still in; zoompan emits d frames from it
for c in clips: args += ["-i", c["audio"]]
n = len(clips); f = []
for k, c in enumerate(clips):
    frames = int(c["dur"] * FPS) + 1
    # a slow push-in; alternate the drift direction so consecutive reveals do not all move the same way
    zx = "iw/2-(iw/zoom/2)" if k % 2 == 0 else "iw/2-(iw/zoom/2)+(zoom-1)*40"
    f.append(f"[{k}:v]scale=1920:1080,zoompan=z='min(zoom+0.00025,1.05)':x='{zx}':y='ih/2-(ih/zoom/2)':d={frames}:s=1920x1080:fps={FPS},format=yuv420p,setsar=1[v{k}]")
prev = "v0"; off = 0.0
for k in range(1, n):
    xf = XF_SLIDE if clips[k]["first_of_slide"] else XF_REVEAL
    off = starts[k]
    out = f"x{k}" if k < n - 1 else "vout"
    f.append(f"[{prev}][v{k}]xfade=transition=fade:duration={xf}:offset={off:.3f}[{out}]"); prev = out
if n == 1: f.append("[v0]copy[vout]")
# narration: each segment delayed to its clip start plus the lead-in, mixed onto one track
a = []
for k, c in enumerate(clips):
    ms = int((starts[k] + LEAD) * 1000)
    a.append(f"[{n+k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[a{k}]")
f += a
f.append("".join(f"[a{k}]" for k in range(n)) + f"amix=inputs={n}:normalize=0:dropout_transition=0,apad=whole_dur={total:.3f}[aout]")
out = sys.argv[1] if len(sys.argv) > 1 else "texas-inservice.mp4"
open("filter.txt", "w").write(";\n".join(f))
args += ["-/filter_complex", "filter.txt", "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-profile:v", "high",
         "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-t", f"{total:.3f}", out]
print(f"{n} clips, {total/60:.1f} min")
subprocess.run(args, check=True)
print("wrote", out, os.path.getsize(out) // 1_000_000, "MB")
