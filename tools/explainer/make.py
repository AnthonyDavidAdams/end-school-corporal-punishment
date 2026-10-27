#!/usr/bin/env python3
"""The hand-drawn explainer, one per state (or district), from the method in the "Make a Hand-Drawn Explainer
Video with Claude" guide, with fal in place of Higgsfield: a style, a script, a still per scene, Seedance 2.5
image-to-video with the next scene's still as the end frame so each clip morphs into the next, narration,
word timestamps, and a Remotion edit with word-by-word subtitles.

  make.py fill   --state NC                      script with the state's numbers -> out/explainer/NC/script.json
  make.py stills --state NC [--scenes s01,s02]   flux-pro ultra, one still per scene, fixed style and seed
  make.py clips  --state NC [--scenes ...] [--res 720p|1080p]   Seedance 2.5 i2v, 5 s, end frame = next still
  make.py voice  --state NC                      ElevenLabs narration per scene (or --voice-dir with your own mp3s)
  make.py words  --state NC                      Whisper word timestamps per scene
  make.py stage  --state NC                      copy media + data.json into tools/film-remotion/public/explainer/
  make.py render --state NC [--vertical] [--draft]   Remotion render -> out/explainer/NC/explainer[-vertical].mp4
  make.py all    --state NC                      everything in order (asks nothing; mind the cost line it prints)

Every generated file is cached by name; delete a file to regenerate it. Numbers in the narration are spelled
out in words because the TTS reads digits badly. Nothing here sends mail or touches the record."""
import argparse, json, os, re, shutil, subprocess, sys, time, csv
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REM = os.path.join(ROOT, "tools/film-remotion")
OUT = os.path.join(ROOT, "out/explainer")
PY = os.path.expanduser("~/.fal-venv/bin/python")
FPS, LEAD, TAIL, XF = 30, 0.5, 0.9, 0.6
SEED = 20261027
STATE_NAME = {"AL": "Alabama", "AR": "Arkansas", "AZ": "Arizona", "FL": "Florida", "GA": "Georgia", "IN": "Indiana", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "MO": "Missouri", "MS": "Mississippi", "NC": "North Carolina", "OK": "Oklahoma", "SC": "South Carolina", "TN": "Tennessee", "TX": "Texas", "WY": "Wyoming"}

# ------------------------------------------------------------------ numbers in words (the voice reads digits badly)
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "zero ten twenty thirty forty fifty sixty seventy eighty ninety".split()
def words(n):
    n = int(n)
    if n < 20: return ONES[n]
    if n < 100: return TENS[n // 10] + ("" if n % 10 == 0 else "-" + ONES[n % 10])
    if n < 1000: return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " and " + words(n % 100))
    if n < 1000000: return words(n // 1000) + " thousand" + ("" if n % 1000 == 0 else (", " if n % 1000 >= 100 else " and ") + words(n % 1000))
    return words(n // 1000000) + " million" + ("" if n % 1000000 == 0 else ", " + words(n % 1000000))

# ------------------------------------------------------------------ real first-hand accounts, verified at the page (facts/claims/testimony-first-hand-accounts.md)
WITNESS = {
    "NC": {"name": "Allison", "voice": "witness", "quote": "That's like my first time ever being in trouble! And my dad was like, 'Just paddle her.' Because down here in the mountains, we do it the old-school way.",
           "card": "Allison Collins, paddled as a sophomore at Robbinsville High, Graham County. WUNC, 2017."},
    "MS": {"name": "Sherrell", "voice": "witness", "quote": "I was paddled with a dress on. A dress. Having to bend over, touch the desk, with a dress on. No.",
           "card": "Sherrell McGee, former student and parent, Collins, Mississippi. The Hechinger Report, 2022."},
    "TX": {"name": "Greg", "voice": "witness_m", "quote": "He asked me to essentially bend over his desk, and he hit me three times. It was three full swing hits, and each one hurt more than the last.",
           "card": "Greg Hooper, paddled at 16 at Alvarado High School. KERA News, 2026."},
}

# ------------------------------------------------------------------ the state's numbers, the same sources as the board page
def crdc(year, code):
    p = os.path.join(ROOT, "data/crdc", year, "states.csv")
    if not os.path.exists(p): return {}
    for r in csv.DictReader(open(p)):
        if r["state"] == code: return {k: (float(v) if re.match(r"^-?\d+(\.\d+)?$", v or "") else v) for k, v in r.items()}
    return {}

def fill(code):
    base = json.load(open(os.path.join(os.path.dirname(__file__), "script.json")))
    st = STATE_NAME.get(code, code)
    states = json.load(open(os.path.join(ROOT, "site/data/states.json"))); srow = (states.get(code) if isinstance(states, dict) else next((s for s in states if s["code"] == code), None)) or {}
    partial = srow.get("status") == "partial"
    model = (json.load(open(os.path.join(ROOT, "data/states/model-language.json"))) or {}).get(code) or {}
    recs = json.load(open(os.path.join(ROOT, "site/data/records", f"{code}.json")))
    bans = sum(1 for r in recs if r.get("status") == "bans")
    lag = sum(1 for d in json.load(open(os.path.join(ROOT, "data/outreach/policy-lag.json"))) if d["state"] == code)
    c24, c17 = crdc("2023-24", code), crdc("2017-18", code)
    struck = int(c24.get("students") or 0); struck17 = int(c17.get("students") or 0)
    used = int(model.get("used_by") or 0); own = used >= 5 and model.get("modal_quote")
    sentence = re.sub(r"^Corporal Punishment\s+", "", str(model.get("modal_quote") or "")).strip() if own else "The Board prohibits the use of corporal punishment in the District."
    f = {"state": st, "state_code": code}
    f["opening_count"] = (f"No district in the state has used it since twenty eighteen, but the law still allows it." if partial and not struck
                          else f"Last school year, {words(struck)} {st} students were struck." if struck else "It is on the books, and on the federal record.")
    f["who_line"] = (f"Of every one hundred students paddled in {st}, {words(round(100 * (c24.get('boys') or 0) / struck))} are boys, and {words(round(100 * (c24.get('with_disabilities') or 0) / struck))} have a disability." if struck else "")
    f["who_highlight"] = "have a disability"
    f["trend_line"] = (f"It is already leaving. In twenty seventeen, {st} schools reported {words(struck17)} students paddled. Last year, {words(struck)}." if struck and struck17 and struck17 > struck else "")
    f["lag_line"] = (f"{words(lag).capitalize()} {st} districts did not use it once last year, but their policy manual still says they may. The paper lags the practice." if lag else "")
    f["boards_line"] = f"{words(bans).capitalize()} {st} school boards already prohibit it in writing." if bans else f"Boards across the country have ended it with one sentence."
    f["sentence_line"] = (f"{words(used).capitalize()} of them use the same sentence: {sentence}" if own else f"Most of them use one sentence: {sentence}")
    f["sentence_highlight"] = sentence.split(",")[0][:40]
    # The opener. Ava, grown, remembering: a composite drawn from the published first-hand accounts in
    # facts/claims/testimony-first-hand-accounts.md, and said to be one on the card. Never a real child's name.
    f["witness_quote"] = ("I was nine. The principal's office had a wooden chair, and I was told to put my hands on it. I remember the sound more than the pain, "
                          "and that the secretary kept typing. Three licks. Then I walked back to class, and everybody knew, and I sat down very carefully. "
                          "I did not shove anyone again. I also did not raise my hand again that year.")
    f["witness_attr"] = "Ava, remembering. A composite of published accounts."
    f["after_witness"] = "That is what being hit at school is like."
    f["witness_voice"] = "witness"
    # Where a state has a verified first-hand account on file, it opens instead, read aloud and attributed on the card.
    real = WITNESS.get(code)
    if real:
        f["witness_quote"], f["witness_attr"], f["after_witness"], f["witness_voice"] = real["quote"], real["card"], f"That was {real['name']}, remembering.", real["voice"]
    f["who_card"] = (f"{round(100 * (c24.get('boys') or 0) / struck)} of every 100 are boys. {round(100 * (c24.get('with_disabilities') or 0) / struck)} have a disability." if struck else "")
    f["lag_card"] = f"{lag:,} {st} districts: zero use, policy still permits" if lag else ""
    f["sentence_card"] = (f"{used} {st} boards use this sentence" if own else f"{bans} {st} boards prohibit it in writing")
    skip = set()
    if not f["who_line"]: skip.add("no_crdc")
    if not f["trend_line"]: skip.add("no_trend")
    if not f["lag_line"]: skip.add("no_lag")
    scenes = []
    for s in base["scenes"]:
        if s.get("skip_if") in skip: continue
        s = dict(s); s["vo"] = s["vo"].format(**f); s["highlight"] = [h.format(**f) for h in s.get("highlight", [])]
        if s.get("card"): s["card"] = s["card"].format(**f)
        if s.get("voice") == "witness": s["voice"] = f["witness_voice"]
        scenes.append(s)
    out = {"state": code, "state_name": st, "title": base["title"], "voice": base["voice"], "voice_witness": base.get("voice_witness"), "style": base["style"], "motion": base["motion"], "scenes": scenes, "facts": f}
    d = os.path.join(OUT, code); os.makedirs(d, exist_ok=True)
    json.dump(out, open(os.path.join(d, "script.json"), "w"), indent=1)
    print(f"{code}: {len(scenes)} scenes"); [print(f"  {s['id']}: {s['vo']}") for s in scenes]
    return out

def load(code):
    p = os.path.join(OUT, code, "script.json")
    return json.load(open(p)) if os.path.exists(p) else fill(code)

# ------------------------------------------------------------------ fal
def fal(model, payload):
    """One fal call through the project venv; returns the result JSON. Keeps this file free of fal_client."""
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

def fetch(url, path):
    subprocess.run(["curl", "-sL", "-o", path, url], check=True, timeout=600)

def pick(scenes, only): return [s for s in scenes if not only or s["id"] in only]

def stills(code, only=None):
    sc = load(code); d = os.path.join(OUT, code, "img"); os.makedirs(d, exist_ok=True); n = 0
    for s in pick(sc["scenes"], only):
        p = os.path.join(d, s["id"] + ".png")
        if os.path.exists(p): continue
        prompt = f"{s['image']}. {sc['style']}"
        r = fal("fal-ai/flux-pro/v1.1-ultra", {"prompt": prompt, "aspect_ratio": "16:9", "seed": SEED, "safety_tolerance": "2", "output_format": "png", "raw": False})
        raw = p[:-4] + ".raw.png"; fetch(r["images"][0]["url"], raw)
        # the paper scraps come back with fake lettering; a second pass strips it so every word in the film is set in the edit
        r2 = fal("fal-ai/flux-pro/kontext", {"prompt": "remove all lettering, letters, words, numbers and logos from every scrap of paper; keep everything else exactly identical", "image_url": r["images"][0]["url"], "output_format": "png", "safety_tolerance": "2"})
        fetch(r2["images"][0]["url"], p); n += 1; print("still", s["id"])
    print(f"stills: {n} new")

def clips(code, only=None, res="720p"):
    sc = load(code); d = os.path.join(OUT, code, "clips"); os.makedirs(d, exist_ok=True); n = 0
    ids = [s["id"] for s in sc["scenes"]]
    for s in pick(sc["scenes"], only):
        p = os.path.join(d, s["id"] + ".mp4")
        if os.path.exists(p): continue
        img = os.path.join(OUT, code, "img", s["id"] + ".png")
        nxt = ids[ids.index(s["id"]) + 1] if ids.index(s["id"]) + 1 < len(ids) else None
        end = os.path.join(OUT, code, "img", nxt + ".png") if nxt else None
        payload = {"image_url": upload(img), "prompt": f"{s['image']}. {sc['motion']}" + (" Over the clip the picture gently dissolves and redraws itself into the next scene." if end and os.path.exists(end) else ""),
                   "duration": "5", "resolution": res, "generate_audio": False, "codec": "H264"}
        if end and os.path.exists(end): payload["end_image_url"] = upload(end)
        r = fal("bytedance/seedance-2.5/us/image-to-video", payload)
        fetch(r["video"]["url"], p); n += 1; print("clip", s["id"])
    print(f"clips: {n} new")

def voice(code, voice_dir=None):
    sc = load(code); d = os.path.join(OUT, code, "tts"); os.makedirs(d, exist_ok=True); n = 0
    for s in sc["scenes"]:
        p = os.path.join(d, s["id"] + ".mp3")
        if voice_dir:
            src = os.path.join(voice_dir, s["id"] + ".mp3")
            if os.path.exists(src) and not os.path.exists(p): shutil.copy(src, p); n += 1
            continue
        if os.path.exists(p): continue
        v = {"witness": sc.get("voice_witness"), "witness_m": {"model": sc["voice"]["model"], "voice": "Daniel", "speed": 0.93}}.get(s.get("voice")) or sc["voice"]
        r = fal(v["model"], {"text": s["vo"], "voice": v["voice"], "speed": v["speed"], "stability": 0.5, "similarity_boost": 0.75})
        fetch(r["audio"]["url"], p); n += 1; print("voice", s["id"])
    print(f"voice: {n} new")

def words_(code):
    sc = load(code); d = os.path.join(OUT, code, "tts"); n = 0
    for s in sc["scenes"]:
        p = os.path.join(d, s["id"] + ".json")
        if os.path.exists(p): continue
        mp3 = os.path.join(d, s["id"] + ".mp3")
        r = fal("fal-ai/whisper", {"audio_url": upload(mp3), "task": "transcribe", "language": "en", "chunk_level": "word"})
        ws = [{"w": c["text"].strip(), "s": round(c["timestamp"][0], 3), "e": round(c["timestamp"][1], 3)} for c in r.get("chunks", []) if c.get("text", "").strip()]
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3], capture_output=True, text=True).stdout.strip() or 0)
        json.dump({"vo_dur": dur, "words": ws}, open(p, "w")); n += 1; print("words", s["id"], len(ws))
    print(f"words: {n} new")

def stage(code):
    sc = load(code); src = os.path.join(OUT, code); dst = os.path.join(REM, "public/explainer")
    if os.path.exists(dst): shutil.rmtree(dst)
    for sub in ("img", "clips", "tts"): shutil.copytree(os.path.join(src, sub), os.path.join(dst, sub), dirs_exist_ok=True)
    scenes = []
    for s in sc["scenes"]:
        t = json.load(open(os.path.join(src, "tts", s["id"] + ".json")))
        scenes.append({"id": s["id"], "vo": s["vo"], "card": s.get("card") or "", "voice": s.get("voice") or "narrator", "highlight": s.get("highlight", []), "vo_dur": t["vo_dur"], "words": t["words"], "clip_len": 5.0})
    data = {"fps": FPS, "lead": LEAD, "tail": TAIL, "xf": XF, "state": code, "state_name": sc["state_name"], "title": sc["title"], "scenes": scenes}
    json.dump(data, open(os.path.join(dst, "data.json"), "w"), indent=1)
    print(f"staged {len(scenes)} scenes, {round(sum(s['vo_dur'] + LEAD + TAIL for s in scenes) - XF * (len(scenes) - 1), 1)} s")

def render(code, vertical=False, draft=False):
    comp = "ExplainerVertical" if vertical else "Explainer"
    out = os.path.join(OUT, code, f"explainer{'-vertical' if vertical else ''}{'-draft' if draft else ''}.mp4")
    args = ["npx", "remotion", "render", "src/index.ts", comp, out, "--crf", "24" if draft else "18"]
    if draft: args += ["--scale", "0.5", "--x264-preset", "veryfast"]
    r = subprocess.run(args, cwd=REM, capture_output=True, text=True, timeout=3600)
    print(r.stdout[-600:] if r.returncode == 0 else r.stderr[-1500:]); print("wrote", out)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("cmd"); ap.add_argument("--state", required=True); ap.add_argument("--scenes"); ap.add_argument("--res", default="720p")
    ap.add_argument("--voice-dir"); ap.add_argument("--vertical", action="store_true"); ap.add_argument("--draft", action="store_true")
    a = ap.parse_args(); only = set(a.scenes.split(",")) if a.scenes else None; code = a.state.upper()
    if a.cmd == "fill": fill(code)
    elif a.cmd == "stills": stills(code, only)
    elif a.cmd == "clips": clips(code, only, a.res)
    elif a.cmd == "voice": voice(code, a.voice_dir)
    elif a.cmd == "words": words_(code)
    elif a.cmd == "stage": stage(code)
    elif a.cmd == "render": render(code, a.vertical, a.draft)
    elif a.cmd == "all":
        fill(code); stills(code); clips(code, None, a.res); voice(code, a.voice_dir); words_(code); stage(code); render(code, a.vertical, a.draft)
    else: print(__doc__)
