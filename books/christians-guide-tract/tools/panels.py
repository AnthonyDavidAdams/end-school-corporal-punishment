#!/usr/bin/env python3
"""Cartoons for the tract, generated on fal.ai with GPT Image 2.

  panels.py md                 # render panels.md from panels.yaml (free)
  panels.py estimate           # print the full estimated cost (free)
  panels.py sheet              # art/character-sheet.png (one paid call)
  panels.py panels [ids...]    # art/sNN.png for every panel without one (paid; --force redoes)
  panels.py cover              # build/cover/front-art.png lettered by the model (paid)

Every paid call attaches art/character-sheet.png as a reference image so the cast stays the
same from page to page. Each output gets a .json sidecar (prompt, references, request id) and
a line in generations.jsonl; panels.md is re-rendered after every call. GPT Image 2 exposes
no seed parameter, so the request id and the sidecar are the reproducibility record.
"""
import json, os, sys, time, urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CFG = yaml.safe_load((ROOT / "panels.yaml").read_text())
ART = ROOT / "art"
LOG = ROOT / "generations.jsonl"
PANEL_W, PANEL_H = 1024, 1536


def key():
    if not os.environ.get("FAL_KEY"):
        f = Path.home() / ".fal-venv/.fal_key"
        if f.exists():
            os.environ["FAL_KEY"] = f.read_text().strip()
    if not os.environ.get("FAL_KEY"):
        for line in (Path.home() / ".zshenv").read_text().splitlines():
            if "FAL_KEY=" in line:
                os.environ["FAL_KEY"] = line.split("=", 1)[1].strip().strip("\"'")
    return os.environ["FAL_KEY"]


def cast_block(ids):
    return "\n".join(f"- {CFG['cast'][c]}" for c in ids)


def text_block(text):
    if text["kind"] == "balloons":
        lines = []
        for who, words in text["lines"]:
            name = CFG["cast"][who].split(",")[0]
            lines.append(f'{name} says, in a plain speech balloon: "{words}"')
        return "Speech balloons, hand-lettered in neat block capitals, spelled exactly:\n" + "\n".join(lines)
    words = text["lines"][0][1]
    return f'One caption in a plain rectangular box across the foot of the picture, hand-lettered in neat block capitals, spelled exactly: "{words}"'


def panel_prompt(p):
    return "\n\n".join([
        "One page of a small black-and-white tract, portrait.",
        CFG["style"].strip(),
        "The scene: " + " ".join(p["scene"].split()),
        ("The people, drawn exactly as they appear in the attached character sheet:\n" + cast_block(p["cast"])) if p["cast"] else "No recurring characters appear; the two people are described in the scene.",
        text_block(p["text"]),
    ])


def cover_prompt(c):
    t = c["text"]
    return "\n\n".join([
        "The front cover of a small tract, portrait." if c.get("color") else "The front cover of a small black-and-white tract, portrait, printed black ink on white.",
        (c.get("style") or CFG["style"]).strip(),
        "The scene: " + " ".join(c["scene"].split()),
        "The people, drawn exactly as they appear in the attached character sheet:\n" + cast_block(c["cast"]),
        f'Lettering, hand-drawn in bold upright block capitals, black, spelled exactly: a small line at the very top "{t["series"]}"; beneath it the title in large letters "{t["title"]}"; beneath the title in smaller mixed-case letters "{t["subtitle"]}"; at the bottom the author "{t["author"]}". All text perfectly spelled, sharp and legible, nothing else written anywhere.',
    ])


def sheet_prompt():
    return "\n\n".join([CFG["sheet_prompt"].strip(), CFG["style"].strip(),
                        "The six people, left to right:\n" + cast_block(list(CFG["cast"]))])


def estimate():
    pr = CFG["pricing"]; n = len(CFG["panels"])
    sheet, panels, cover = pr["sheet_usd"], n * pr["panel_usd"], pr["cover_usd"]
    total = sheet + panels + cover
    print(f"character sheet   1 x ${pr['sheet_usd']:.3f} = ${sheet:.2f}")
    print(f"panels           {n} x ${pr['panel_usd']:.3f} = ${panels:.2f}")
    print(f"cover front       1 x ${pr['cover_usd']:.3f} = ${cover:.2f}")
    print(f"total                        ${total:.2f}  (each redo of a panel adds ${pr['panel_usd']:.3f})")
    return total


def call(model, prompt, out: Path, refs=(), w=PANEL_W, h=PANEL_H):
    import fal_client
    key()
    args = {"prompt": prompt, "image_size": {"width": w, "height": h},
            "quality": "high", "num_images": 1, "output_format": "png"}
    if refs:
        args["image_urls"] = [fal_client.upload_file(str(r)) for r in refs]
    t0 = time.time()
    handle = fal_client.submit(model, arguments=args)
    res = handle.get()
    url = res["images"][0]["url"]
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.rename(out.with_name(f"{out.stem}.prev-{int(out.stat().st_mtime)}{out.suffix}"))
    urllib.request.urlretrieve(url, out)
    meta = {"model": model, "request_id": handle.request_id, "prompt": prompt,
            "refs": [str(Path(r).relative_to(ROOT)) for r in refs], "size": [w, h],
            "quality": "high", "seconds": round(time.time() - t0, 1), "url": url,
            "t": time.strftime("%F %T")}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=1))
    with LOG.open("a") as f:
        f.write(json.dumps({"out": str(out.relative_to(ROOT)), **meta}) + "\n")
    print(f"  done {out.relative_to(ROOT)} ({meta['seconds']}s, request {handle.request_id})", flush=True)
    return out


def sidecar(path: Path):
    j = path.with_suffix(".json")
    return json.loads(j.read_text()) if j.exists() else None


def render_md():
    pr = CFG["pricing"]; n = len(CFG["panels"])
    L = ["# Shot list: the tract's cartoons", "",
         "Thirteen panels, one per spread, plus the cover. Source of truth is `panels.yaml`; this file is rendered from it by `tools/panels.py md` and carries the exact prompt and fal request id of every generated image. Style: plain black ink line drawing in the small gospel-tract tradition, warm and plain, ordinary people in an ordinary school and church, no caricature, no real person, no denomination mocked. Lettering inside the pictures is done by the same GPT Image 2 call, spelled from the shot list.", "",
         "## The cast (consistent across the book)", ""]
    L += [f"- {v}" for v in CFG["cast"].values()]
    L += ["", "The cast is drawn once on `art/character-sheet.png`, which is attached as a reference image to every panel and to the cover.", "",
          "## Estimated cost (fal.ai, high quality, prices read 2026-10-29)", "",
          f"| Item | Count | Each | Total |", "|---|---|---|---|",
          f"| Character sheet, gpt-image-2, 1024x1024 | 1 | ${pr['sheet_usd']:.3f} | ${pr['sheet_usd']:.2f} |",
          f"| Panels, gpt-image-2/edit, 1024x1536 | {n} | ${pr['panel_usd']:.3f} | ${n*pr['panel_usd']:.2f} |",
          f"| Cover front, gpt-image-2/edit, 1024x1536 | 1 | ${pr['cover_usd']:.3f} | ${pr['cover_usd']:.2f} |",
          f"| **Total** | | | **${pr['sheet_usd']+n*pr['panel_usd']+pr['cover_usd']:.2f}** |", "",
          f"Each redo of a panel adds ${pr['panel_usd']:.3f}. The cover is upscaled with Pillow (free); no other paid call.", ""]
    sheet = sidecar(ART / "character-sheet.png")
    L += ["## Character sheet", "", f"`art/character-sheet.png`" + (f", request `{sheet['request_id']}`, {sheet['t']}" if sheet else ", not yet generated"), ""]
    for p in CFG["panels"]:
        meta = sidecar(ART / f"{p['id']}.png")
        L += [f"## {p['id']}: {p['page']}", "",
              "**Scene.** " + " ".join(p["scene"].split()), "",
              "**Text.** " + ("; ".join(f"{(CFG['cast'][w].split(',')[0] if w else 'caption')}: “{t}”" for w, t in p["text"]["lines"])), "",
              "**Cast.** " + (", ".join(p["cast"]) or "none of the recurring cast"), ""]
        if meta:
            L += [f"**Generated.** `art/{p['id']}.png`, model `{meta['model']}`, request `{meta['request_id']}`, {meta['t']}, {meta['size'][0]}x{meta['size'][1]} high quality, references {meta['refs']}.", "",
                  "<details><summary>Exact prompt</summary>", "", "```", meta["prompt"], "```", "", "</details>", ""]
        else:
            L += ["**Prompt (to be sent).**", "", "```", panel_prompt(p), "```", ""]
    c = CFG["cover"]; meta = sidecar(ROOT / "build/cover/front-art.png")
    L += ["## Cover", "", "**Scene.** " + " ".join(c["scene"].split()), "",
          f"**Lettering.** {c['text']['series']} / {c['text']['title']} / {c['text']['subtitle']} / {c['text']['author']}", ""]
    if meta:
        L += [f"**Generated.** `build/cover/front-art.png`, request `{meta['request_id']}`, {meta['t']}.", "", "<details><summary>Exact prompt</summary>", "", "```", meta["prompt"], "```", "", "</details>", ""]
    else:
        L += ["**Prompt (to be sent).**", "", "```", cover_prompt(c), "```", ""]
    (ROOT / "panels.md").write_text("\n".join(L))
    print("panels.md rendered")


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "md"
    force = "--force" in argv
    ids = [a for a in argv[2:] if not a.startswith("--")]
    if cmd == "md":
        render_md(); return
    if cmd == "estimate":
        estimate(); return
    sheet = ART / "character-sheet.png"
    if cmd == "sheet":
        call("fal-ai/gpt-image-2", sheet_prompt(), sheet, w=1024, h=1024)
    elif cmd == "panels":
        if not sheet.exists():
            sys.exit("generate the character sheet first: panels.py sheet")
        from concurrent.futures import ThreadPoolExecutor
        todo = []
        for p in CFG["panels"]:
            if ids and p["id"] not in ids:
                continue
            out = ART / f"{p['id']}.png"
            if out.exists() and not force and sidecar(out):
                print(f"  keep {out.name}"); continue
            todo.append((p, out))
        print(f"  generating {[p['id'] for p, _ in todo]}", flush=True)
        with ThreadPoolExecutor(max_workers=4) as ex:
            list(ex.map(lambda po: call("fal-ai/gpt-image-2/edit", panel_prompt(po[0]), po[1], refs=[sheet]), todo))
    elif cmd == "cover":
        if not sheet.exists():
            sys.exit("generate the character sheet first: panels.py sheet")
        refs = [sheet] + ([ROOT / CFG["cover"]["bw_reference"]] if CFG["cover"].get("bw_reference") and (ROOT / CFG["cover"]["bw_reference"]).exists() else [])
        call("fal-ai/gpt-image-2/edit", cover_prompt(CFG["cover"]), ROOT / "build/cover/front-art.png", refs=refs)
    else:
        sys.exit(__doc__)
    render_md()


if __name__ == "__main__":
    main(sys.argv)
