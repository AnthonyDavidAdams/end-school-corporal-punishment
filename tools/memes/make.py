#!/usr/bin/env python3
"""Compose meme/card images from a spec: fal.ai (Flux) background + Pillow-set type.
Usage: ~/.fal-venv/bin/python tools/memes/make.py spec.json --out share/<audience>/ [--no-art] [--model fal-ai/flux-pro/v1.1-ultra]
"""
import argparse, json, os, subprocess, sys, textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONTS = {
    "slab": ("/System/Library/Fonts/Supplemental/Rockwell.ttc", "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf"),
    "serif": ("/System/Library/Fonts/Supplemental/Georgia Bold.ttf", "/System/Library/Fonts/Supplemental/Georgia.ttf"),
    "sans": ("/System/Library/Fonts/Supplemental/Futura.ttc", "/System/Library/Fonts/Supplemental/Arial Narrow.ttf"),
    "condensed": ("/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Narrow.ttf"),
}
SIZES = {"square": (1080, 1080), "portrait": (1080, 1350), "story": (1080, 1920), "letter": (2550, 3300), "half": (1650, 2550), "card": (1800, 1200)}

def font(path, size):
    for p in (path, "/System/Library/Fonts/Supplemental/Georgia Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        try: return ImageFont.truetype(p, size)
        except Exception: continue
    return ImageFont.load_default()

def fit_lines(draw, text, f, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= max_w: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def gen_art(prompt, out, model, aspect):
    run = Path.home() / ".claude/skills/fal/run.py"
    py = Path.home() / ".fal-venv/bin/python"
    subprocess.run([str(py), str(run), "t2i", "--prompt", prompt, "--model", model, "--aspect-ratio", aspect, "--output", str(out)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    return out

def compose(spec, art_path, out_path):
    W, H = SIZES.get(spec.get("format", "square"), SIZES["square"])
    pal = {"bg": "#f4efe6", "ink": "#1c1c1c", "accent": "#8b1e1e", **spec.get("palette", {})}
    head_font, body_font = FONTS.get(spec.get("type", "slab"), FONTS["slab"])
    img = Image.new("RGB", (W, H), pal["bg"])
    if art_path and Path(art_path).exists():
        art = Image.open(art_path).convert("RGB")
        # cover-fit the art into the top 58% of the canvas
        ah = int(H * 0.5)
        scale = max(W / art.width, ah / art.height)
        art = art.resize((int(art.width * scale), int(art.height * scale)))
        left, top = (art.width - W) // 2, (art.height - ah) // 2
        img.paste(art.crop((left, top, left + W, top + ah)), (0, 0))
        # fade into the text panel
        grad = Image.new("L", (W, 160), 0)
        for y in range(160): ImageDraw.Draw(grad).line([(0, y), (W, y)], fill=int(255 * y / 160))
        panel = Image.new("RGB", (W, 160), pal["bg"])
        img.paste(panel, (0, ah - 160), grad)
        y = ah + 20
    else:
        y = int(H * 0.14)
    d = ImageDraw.Draw(img)
    m = int(W * 0.07); max_w = W - 2 * m
    foot_size = int(W * 0.028); foot_y = H - m - foot_size
    avail = foot_y - int(W * 0.04) - y
    # fit the whole block: shrink headline (and body proportionally) until it fits above the footer
    scale = 1.0
    while True:
        hs = max(30, int(W * 0.085 * scale)); f = font(head_font, hs); hl = fit_lines(d, spec["headline"], f, max_w)
        ss = int(W * 0.042 * scale); f2 = font(body_font, ss); sl = fit_lines(d, spec.get("sub", ""), f2, max_w) if spec.get("sub") else []
        fs = int(W * 0.030 * scale); f3 = font(body_font, fs); fl = fit_lines(d, spec.get("fact", ""), f3, max_w) if spec.get("fact") else []
        block = len(hl) * int(hs * 1.12) + int(W * 0.055) + (len(sl) * int(ss * 1.3) + int(W * 0.03) if sl else 0) + len(fl) * int(fs * 1.35)
        if block <= avail or scale < 0.45: break
        scale -= 0.04
    if not art_path: y = max(int(H * 0.1), (H - block) // 2 - int(H * 0.05))
    for ln in hl:
        d.text((m, y), ln, font=f, fill=pal["ink"]); y += int(hs * 1.12)
    y += int(W * 0.02)
    d.line([(m, y), (m + int(W * 0.12), y)], fill=pal["accent"], width=max(4, W // 200)); y += int(W * 0.035)
    for ln in sl:
        d.text((m, y), ln, font=f2, fill=pal["ink"]); y += int(ss * 1.3)
    if sl: y += int(W * 0.03)
    for ln in fl:
        d.text((m, y), ln, font=f3, fill=pal["accent"]); y += int(fs * 1.35)
    f4 = font(body_font, foot_size)
    d.text((m, foot_y), spec.get("footer", "earthpilot.org/kids"), font=f4, fill=pal["ink"])
    img.save(out_path, "PNG", optimize=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("spec"); ap.add_argument("--out", required=True)
    ap.add_argument("--no-art", action="store_true"); ap.add_argument("--model", default="fal-ai/flux-pro/v1.1-ultra")
    a = ap.parse_args()
    specs = json.load(open(a.spec)); out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    manifest = ["# Manifest", "", "| file | audience | format | claims |", "|---|---|---|---|"]
    for s in specs:
        art = None
        if not a.no_art and s.get("art"):
            W, H = SIZES.get(s.get("format", "square"), SIZES["square"])
            aspect = "1:1" if W == H else ("3:4" if H > W else "4:3")
            art = out / f"{s['id']}.art.png"
            if not art.exists():
                print(f"art: {s['id']}"); gen_art(s["art"] + ", no text, no letters, no people, no logos", art, a.model, aspect)
        dest = out / f"{s['id']}.png"; compose(s, art, dest); print(f"wrote {dest}")
        manifest.append(f"| {dest.name} | {s['audience']} | {s.get('format','square')} | {', '.join(s.get('claims', []))} |")
    (out / "manifest.md").write_text("\n".join(manifest) + "\n")

if __name__ == "__main__": main()
