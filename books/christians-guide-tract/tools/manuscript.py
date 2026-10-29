#!/usr/bin/env python3
"""Assemble 03-manuscript/full-manuscript.md from the chapter files in book.yaml order,
with the LaTeX page macros stripped, so the whole tract can be read as one document
(and fed to build-kdp-epub later)."""
import re, yaml
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
cfg = yaml.safe_load((ROOT / "book.yaml").read_text())
out = [f"# {cfg['title']}", f"*{cfg['subtitle']}*", f"{cfg['author']}", ""]
for ch in cfg["chapters"]:
    t = (ROOT / ch).read_text()
    heads = re.findall(r"\\spreadHead\{(.*?)\}\{(.*?)\}", t)
    panel = re.search(r"\\panelPage\{(.*?)\}", t)
    src = re.search(r"\\spreadSource\{(.*?)\}", t)
    items = re.findall(r"\\item (.*)", t)
    t = re.sub(r"```\{=latex\}.*?```", "", t, flags=re.S).strip()
    t = t.replace("\\mbox{", "").replace("/}", "/")
    for h, ref in heads:
        out += [f"## {h}", f"*{ref}*" if ref else ""]
    if panel: out += [f"![{Path(panel.group(1)).stem}]({panel.group(1)})", ""]
    out += [t, ""]
    if items: out += ["- " + i for i in items] + [""]
    if src and src.group(1).strip(): out += [f"<small>Facts registry: {src.group(1)}</small>", ""]
(ROOT / "03-manuscript/full-manuscript.md").write_text("\n".join(out))
print("manuscript:", len("\n".join(out).split()), "words")
