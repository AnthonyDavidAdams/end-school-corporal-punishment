#!/usr/bin/env python3
"""The national edition of "One Sentence" from tools/film/script-national.json, reusing everything the Texas
edition (script-v3.json, rendered with tools/film-remotion) already paid for: every Kling clip, every Flux
still, the music bed, and the voice of every scene whose narration did not change.

  national.py estimate            which lines changed, how many characters, what the fal calls will cost
  national.py voice --yes         ElevenLabs (fal-ai/elevenlabs/tts/multilingual-v2, Brian, speed 0.95) for the
                                  changed lines only; unchanged lines are copied from out/video/one-sentence/v3/tts
  national.py words               Whisper word timestamps (fal-ai/whisper) for the new lines, aligned back onto
                                  the script's own words so digits become the spelled-out numbers the cues use
  national.py stage               media + fonts into tools/film-remotion/public/, data-national.json from the script
  national.py render [--draft]    Remotion -> out/video/one-sentence/one-sentence-national.mp4, plus the poster
  national.py check               every narration line and on-screen label, grepped for Texas-only claims
  national.py shots [--clips]     Kontext-edit the two stills that carried a Texas flag; with --clips, Kling them again

Nothing here spends money without --yes on `voice` (the only step that bills more than pennies). Every output is
cached by name; delete a file to regenerate it. No em dashes in copy; numbers in narration spelled out."""
import argparse, difflib, json, os, re, shutil, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FILM = os.path.join(ROOT, "tools/film"); REM = os.path.join(ROOT, "tools/film-remotion")
OUT = os.path.join(ROOT, "out/video/one-sentence"); NAT = os.path.join(OUT, "national"); V3TTS = os.path.join(OUT, "v3/tts")
PY = os.path.expanduser("~/.fal-venv/bin/python")
FPS, LEAD, TAIL, XF = 30, 0.5, 0.9, 0.6
TTS_MODEL = "fal-ai/elevenlabs/tts/multilingual-v2"; TTS_PRICE_PER_1K_CHARS = 0.10   # fal.ai model page, 2026-10-28
WHISPER_MODEL = "fal-ai/whisper"

def load(name): return json.load(open(os.path.join(FILM, name)))
def by_id(sc): return {s["id"]: s for s in sc["scenes"]}

# ------------------------------------------------------------------ fal, through the project venv (same pattern as tools/explainer/make.py)
def fal(model, payload):
    code = ("import json,sys,os,fal_client\n"
            "k=open(os.path.expanduser('~/.fal-venv/.fal_key')).read().strip() if os.path.exists(os.path.expanduser('~/.fal-venv/.fal_key')) else os.environ.get('FAL_KEY')\n"
            "os.environ['FAL_KEY']=k\n"
            "m,p=json.load(sys.stdin)\n"
            "print(json.dumps(fal_client.subscribe(m, arguments=p)))")
    r = subprocess.run([PY, "-c", code], input=json.dumps([model, payload]), capture_output=True, text=True, timeout=1800)
    if r.returncode: raise RuntimeError(r.stderr[-800:])
    return json.loads(r.stdout.strip().splitlines()[-1])

def upload(path):
    code = ("import sys,os,fal_client\nos.environ['FAL_KEY']=open(os.path.expanduser('~/.fal-venv/.fal_key')).read().strip()\nprint(fal_client.upload_file(sys.argv[1]))")
    r = subprocess.run([PY, "-c", code, path], capture_output=True, text=True, timeout=600)
    if r.returncode: raise RuntimeError(r.stderr[-500:])
    return r.stdout.strip().splitlines()[-1]

def fetch(url, path): subprocess.run(["curl", "-sL", "-o", path, url], check=True, timeout=600)
def dur(path): return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip() or 0)

# ------------------------------------------------------------------ which lines changed
def changed():
    v3, nat = by_id(load("script-v3.json")), load("script-national.json")
    return [s for s in nat["scenes"] if not s.get("reuse_voice") and (s["id"] not in v3 or v3[s["id"]]["vo"].strip() != s["vo"].strip())]

def estimate():
    ch = changed(); chars = sum(len(s["vo"]) for s in ch)
    print(f"{len(ch)} of {len(load('script-national.json')['scenes'])} narration lines changed:")
    for s in ch: print(f"  {s['id']:<14} {len(s['vo']):>4} chars")
    cost = chars / 1000 * TTS_PRICE_PER_1K_CHARS
    print(f"ElevenLabs via fal: {chars} characters at ${TTS_PRICE_PER_1K_CHARS:.2f} per 1,000 = ${cost:.2f}")
    print(f"Whisper via fal: {len(ch)} short clips, billed per compute second, a few cents at most")
    print(f"Total estimate: about ${cost + 0.05:.2f}. No Flux or Kling calls: every still and clip is reused.")
    return ch

# ------------------------------------------------------------------ voice
def voice(yes):
    os.makedirs(os.path.join(NAT, "tts"), exist_ok=True)
    ch = {s["id"] for s in changed()}; n = 0
    for s in load("script-national.json")["scenes"]:
        p = os.path.join(NAT, "tts", s["id"] + ".mp3")
        if os.path.exists(p): continue
        if s["id"] not in ch:
            shutil.copy(os.path.join(V3TTS, s["id"] + ".mp3"), p); print("reuse", s["id"]); continue
        if not yes: print("skip (needs --yes)", s["id"]); continue
        r = fal(TTS_MODEL, {"text": s["vo"], "voice": "Brian", "speed": 0.95, "stability": 0.5, "similarity_boost": 0.75})
        fetch(r["audio"]["url"], p); n += 1; print("voice", s["id"], f"{dur(p):.1f}s", f"{len(s['vo'])} chars")
    print(f"voice: {n} new lines")

# ------------------------------------------------------------------ word timestamps, aligned onto the script's own words
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "zero ten twenty thirty forty fifty sixty seventy eighty ninety".split()
def words(n):
    n = int(n)
    if n < 20: return ONES[n]
    if n < 100: return TENS[n // 10] + ("" if n % 10 == 0 else "-" + ONES[n % 10])
    if n < 1000: return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " and " + words(n % 100))
    if n < 1000000: return words(n // 1000) + " thousand" + ("" if n % 1000 == 0 else (", " if n % 1000 >= 100 else " and ") + words(n % 1000))
    return words(n // 1000000) + " million" + ("" if n % 1000000 == 0 else ", " + words(n % 1000000))
def year_words(n):   # 1974 -> nineteen seventy-four, 2017 -> twenty seventeen, 2023 -> twenty twenty-three
    hi, lo = n // 100, n % 100
    return words(hi) + " " + ("hundred" if lo == 0 else ("oh " + ONES[lo] if lo < 10 else words(lo)))
norm = lambda s: re.sub(r"[^a-z0-9]+", "", s.lower())

def expand(chunks):
    """Whisper chunks (text, s, e) -> tokens; a numeral becomes its spoken words, each given a slice of the chunk's time."""
    merged = []
    for text, s, e in chunks:
        t = text.strip()
        if not t: continue
        if merged and re.match(r"^[,.%]\d*$|^%$", t) and re.search(r"\d$", merged[-1][0]):
            merged[-1] = (merged[-1][0] + t, merged[-1][1], e); continue
        merged.append((t, s, e))
    out = []
    for t, s, e in merged:
        m = re.search(r"\d[\d,]*", t)
        if not m: out.append((t, s, e)); continue
        digits = m.group(0).replace(",", ""); n = int(digits)
        spoken = year_words(n) if (len(digits) == 4 and "," not in m.group(0) and 1500 <= n <= 2099) else words(n)
        if "%" in t: spoken += " percent"
        toks = spoken.replace(",", "").split()
        pre, post = t[:m.start()].strip(), t[m.end():].replace("%", "").strip()
        if pre: toks = [pre] + toks
        if post: toks = toks + [post]
        step = (e - s) / len(toks)
        for i, w in enumerate(toks): out.append((w, s + i * step, s + (i + 1) * step))
    return out

def align(vo, chunks, vo_dur):
    """Map the narration's own tokens onto Whisper's timing. Matched tokens take Whisper's time; the rest are spread
    evenly between their neighbours, so every phrase in the script can be found by the scenes' cue lookup."""
    script = vo.split(); sn = [norm(x) for x in script]
    wt = expand(chunks); wn = [norm(x[0]) for x in wt]
    times = [None] * len(script)
    for a, b, size in difflib.SequenceMatcher(None, sn, wn, autojunk=False).get_matching_blocks():
        for k in range(size): times[a + k] = (wt[b + k][1], wt[b + k][2])
    i = 0
    while i < len(script):
        if times[i] is not None: i += 1; continue
        j = i
        while j < len(script) and times[j] is None: j += 1
        t0 = times[i - 1][1] if i > 0 else 0.0; t1 = times[j][0] if j < len(script) else vo_dur
        step = max(0.0, t1 - t0) / (j - i)
        for k in range(i, j): times[k] = (round(t0 + (k - i) * step, 3), round(t0 + (k - i + 1) * step, 3))
        i = j
    return [{"w": w, "s": round(s, 3), "e": round(e, 3)} for w, (s, e) in zip(script, times)]

def words_():
    sc = load("script-national.json"); n = 0; ch = {s["id"] for s in changed()}
    for s in sc["scenes"]:
        mp3 = os.path.join(NAT, "tts", s["id"] + ".mp3"); p = os.path.join(NAT, "tts", s["id"] + ".words.json")
        if os.path.exists(p) or not os.path.exists(mp3): continue
        v3w = os.path.join(V3TTS, s["id"] + ".words.json")
        if s["id"] not in ch and os.path.exists(v3w):   # reused line: realign the Texas edition's Whisper words, no fal call
            ws = align(s["vo"], [(x["w"], x["s"], x["e"]) for x in json.load(open(v3w))], dur(mp3)); json.dump(ws, open(p, "w")); print("words", s["id"], len(ws), "| realigned from v3"); continue
        r = fal(WHISPER_MODEL, {"audio_url": upload(mp3), "task": "transcribe", "language": "en", "chunk_level": "word"})
        chunks = [(c["text"], float(c["timestamp"][0]), float(c["timestamp"][1])) for c in r.get("chunks", []) if c.get("text", "").strip()]
        json.dump({"raw": r.get("text", ""), "chunks": chunks}, open(os.path.join(NAT, "tts", s["id"] + ".whisper.json"), "w"))
        ws = align(s["vo"], chunks, dur(mp3)); json.dump(ws, open(p, "w")); n += 1
        print("words", s["id"], len(ws), "|", (r.get("text") or "")[:90])
    print(f"words: {n} new")

# ------------------------------------------------------------------ stage: media + data-national.json
def stage():
    pub = os.path.join(REM, "public")
    for sub in ("clips", "img", "music"):
        src, dst = os.path.join(OUT, sub), os.path.join(pub, sub); os.makedirs(dst, exist_ok=True)
        for f in os.listdir(src):
            if not os.path.exists(os.path.join(dst, f)): shutil.copy(os.path.join(src, f), os.path.join(dst, f))
    for f in ("Carlito-Regular.ttf", "Carlito-Bold.ttf"):
        if not os.path.exists(os.path.join(pub, "fonts", f)): shutil.copy(os.path.join(ROOT, "tools/video/fonts", f), os.path.join(pub, "fonts", f))
    os.makedirs(os.path.join(pub, "tts-national"), exist_ok=True)
    sc = load("script-national.json"); scenes = []; placeholders = []
    for s in sc["scenes"]:
        mp3 = os.path.join(NAT, "tts", s["id"] + ".mp3"); wj = os.path.join(NAT, "tts", s["id"] + ".words.json")
        if not (os.path.exists(mp3) and os.path.exists(wj)):   # not voiced yet: the v3 line stands in so the composition still builds
            mp3, wj = os.path.join(V3TTS, s["id"] + ".mp3"), os.path.join(V3TTS, s["id"] + ".words.json"); placeholders.append(s["id"])
        shutil.copy(mp3, os.path.join(pub, "tts-national", s["id"] + ".mp3"))
        scenes.append({**s, "vo_dur": dur(mp3), "words": json.load(open(wj))})
    data = {"fps": FPS, "lead": LEAD, "tail": TAIL, "xf": XF, "edition": "national", "tts": "tts-national", "scenes": scenes}
    json.dump(data, open(os.path.join(pub, "data-national.json"), "w"), indent=1)
    total = sum(s["vo_dur"] + LEAD + TAIL for s in scenes) - XF * (len(scenes) - 1)
    print(f"staged {len(scenes)} scenes, {total:.1f} s" + (f"; PLACEHOLDER voice (v3 line) for {', '.join(placeholders)}" if placeholders else ""))

# ------------------------------------------------------------------ render + poster
def render(draft=False, frames=None):
    out = os.path.join(OUT, "one-sentence-national" + ("-draft" if draft else "") + ".mp4")
    args = ["npx", "remotion", "render", "src/index.ts", "OneSentenceNational", out, "--crf", "24" if draft else "18"]
    if draft: args += ["--scale", "0.5", "--x264-preset", "veryfast"]
    if frames: args += ["--frames", frames]
    r = subprocess.run(args, cwd=REM, capture_output=True, text=True, timeout=7200)
    print(r.stdout[-800:] if r.returncode == 0 else r.stderr[-2000:])
    if r.returncode: sys.exit(1)
    print("wrote", out, os.path.getsize(out) // 1_000_000, "MB", f"{dur(out):.1f}s")
    if not draft and not frames: poster(out)

def poster(mp4):
    p = os.path.join(ROOT, "site/assets/one-sentence-national-poster.jpg")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "2.4", "-i", mp4, "-frames:v", "1", "-vf", "scale=1280:720", "-q:v", "4", p], check=True)
    print("poster", p, os.path.getsize(p) // 1000, "KB")

# ------------------------------------------------------------------ the two hero shots that carried a Texas flag
# Flux Kontext edits the Texas edition's still (same room, same light), then Kling animates it again; the Texas clips stay.
KONTEXT_MODEL = "fal-ai/flux-pro/kontext"; KLING_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video"
SHOTS = {
    "boardroom_us": {"src": "boardroom", "dur": "5",
        "edit": "Replace the Texas state flag on the right with a plain dark navy blue flag with no emblem, star or lettering, hanging the same way on the same pole with the same gold finial. Change nothing else: same room, same dais, same chairs, same American flag on the left, same light.",
        "move": "Locked-off camera, no camera movement. An empty school board meeting room; nothing moves except an almost imperceptible slow push-in. The flags hang perfectly still. No people, no text, photoreal, quiet evening light."},
    "sunrise_us": {"src": "sunrise", "dur": "10",
        "edit": "Replace the Texas flag on the flagpole with an American flag, the same size, lit the same way by the low sun. Change nothing else: same school, same children, same shadows, same sky.",
        "move": "Locked-off camera, no camera movement. Children with backpacks walk slowly away from the camera toward the school's front doors at sunrise, long shadows moving with them, the American flag on the pole stirring gently in a light breeze. No faces, no text, photoreal, warm light."},
}
def shots(stills=True, clips=False):
    os.makedirs(os.path.join(NAT, "img"), exist_ok=True); os.makedirs(os.path.join(NAT, "clips"), exist_ok=True)
    for name, sh in SHOTS.items():
        still = os.path.join(NAT, "img", name + ".jpg"); clip = os.path.join(NAT, "clips", name + ".mp4")
        if stills and not os.path.exists(still):
            r = fal(KONTEXT_MODEL, {"prompt": sh["edit"], "image_url": upload(os.path.join(OUT, "img", sh["src"] + ".jpg")), "guidance_scale": 3.5, "output_format": "jpeg", "safety_tolerance": "5"})
            fetch(r["images"][0]["url"], still); print("still", name, r["images"][0].get("width"), "x", r["images"][0].get("height"))
        if clips and os.path.exists(still) and not os.path.exists(clip):
            r = fal(KLING_MODEL, {"prompt": sh["move"], "image_url": upload(still), "duration": sh["dur"], "cfg_scale": 0.5, "negative_prompt": "camera movement, zoom, pan, text, lettering, blur, distortion, extra limbs, morphing"})
            fetch(r["video"]["url"], clip); print("clip", name, f"{dur(clip):.2f}s")
    for name in SHOTS:   # staged next to the Texas clips under their own names
        c = os.path.join(NAT, "clips", name + ".mp4"); dst = os.path.join(REM, "public/clips", name + ".mp4")
        if os.path.exists(c) and os.path.isdir(os.path.dirname(dst)): shutil.copy(c, dst)

# ------------------------------------------------------------------ check: no Texas-only claim survives
def check():
    sc = load("script-national.json"); bad = 0
    for s in sc["scenes"]:
        texts = [s["vo"]] + list((s.get("screen") or {}).values()) + [str(v) for v in (s.get("fig") or {}).values() if not isinstance(v, list)]
        for v in (s.get("fig") or {}).values():
            if isinstance(v, list): texts += [str(x) for row in v for x in (row if isinstance(row, list) else [row])]
        for t in texts:
            if "—" in t: print("EM DASH", s["id"], t[:80]); bad += 1
            if re.search(r"\d", s["vo"]): print("DIGIT IN NARRATION", s["id"]); bad += 1
            if re.search(r"\bTexas\b", t) and s["id"] not in ("s11_board", "s12_sentence"): print("TEXAS", s["id"], t[:100]); bad += 1
    print("check:", "clean" if not bad else f"{bad} problems")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("cmd"); ap.add_argument("--yes", action="store_true"); ap.add_argument("--draft", action="store_true"); ap.add_argument("--frames"); ap.add_argument("--clips", action="store_true")
    a = ap.parse_args()
    {"estimate": lambda: estimate(), "voice": lambda: voice(a.yes), "words": words_, "stage": stage, "render": lambda: render(a.draft, a.frames), "check": check,
     "poster": lambda: poster(os.path.join(OUT, "one-sentence-national.mp4")), "shots": lambda: shots(True, a.clips)}.get(a.cmd, lambda: print(__doc__))()
