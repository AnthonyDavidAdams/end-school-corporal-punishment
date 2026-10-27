"""The decisions desk: one page (site/ops/decisions.html, noindex) and one JSON (data/outreach/decisions.json)
listing everything that is waiting on Anthony, numbered, with the drafted text where there is one. Built after
the CRM in every cycle. Anthony answers by number ("3 send, 5 skip, release board TX") and Claude acts.

  python3 tools/decisions.py"""
import json, os, sys, html, datetime, collections
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "tools/outreach"))
try: import run as outreach
except Exception: outreach = None
esc = html.escape
reqs = json.load(open(os.path.join(ROOT, "data/outreach/requests.json")))
extra = json.load(open(os.path.join(ROOT, "data/outreach/decisions-extra.json"))) if os.path.exists(os.path.join(ROOT, "data/outreach/decisions-extra.json")) else []
items = []

def preview(r):
    try: return outreach.body_for(r) if outreach else (r.get("body") or "")
    except Exception as e: return r.get("body") or f"(no preview: {e})"

# 1. replies that need a decision, each with the draft the writer proposed
for r in sorted([x for x in reqs if x["status"] == "needs_review"], key=lambda x: x.get("last_reply_at") or ""):
    m = (r.get("replies") or [{}])[-1]
    items.append({"kind": "reply", "title": f"{r['name']}, {r['state']}: {m.get('kind', 'reply')} from {m.get('from', '?')}", "since": (m.get("date") or r.get("last_reply_at") or "")[:16],
                  "why": m.get("why") or m.get("action") or "", "draft": m.get("suggested") or m.get("text") or "", "request": r["id"], "actions": ["send the draft", "edit", "skip", "close"]})
# 2. held batches, grouped by kind, with one preview and the list
held = collections.defaultdict(list)
for r in reqs:
    if r["status"] == "held": held[r.get("kind", "policy")].append(r)
LABEL = {"align": "Safe School invitations to superintendents", "board_note": "Board-member notes with the film link", "neighbor": "Neighbor asks (next to a district that moved)", "policy": "First asks"}
for k, rs in held.items():
    rs.sort(key=lambda x: (x["state"], x["name"]))
    by_state = collections.Counter(x["state"] for x in rs)
    variants = collections.Counter(x.get("variant") or "A" for x in rs)
    items.append({"kind": "batch", "title": f"{len(rs)} {LABEL.get(k, k)} held ({', '.join(f'{s} {c}' for s, c in sorted(by_state.items()))}; variants {dict(variants)})", "since": min(x.get("queued_at") or "" for x in rs)[:10],
                  "why": "A new message kind or batch waits until you have seen it.", "draft": preview(rs[0]), "list": [f"{x['state']} {x['name']}" + (f" ({x.get('member')})" if x.get("member") else "") + f" -> {x['to']}" + (f" [{x.get('variant')}]" if x.get("variant") else "") for x in rs],
                  "actions": [f"release {k}", f"release {k} <STATES>", "edit the text", "drop"]})
# 3. standing items
for e in extra: items.append({"kind": "standing", "title": e["title"], "since": e.get("since", ""), "why": e.get("detail", ""), "draft": "", "actions": ["go", "skip", "later"]})

now = datetime.datetime.now()
lines = [f"{i+1}. {it['title']}" for i, it in enumerate(items)]
json.dump({"as_of": now.isoformat(timespec="minutes"), "count": len(items), "lines": lines, "items": [{k: v for k, v in it.items() if k != "draft"} for it in items]}, open(os.path.join(ROOT, "data/outreach/decisions.json"), "w"), indent=1)
rows = []
for i, it in enumerate(items):
    rows.append(f'<section class="d"><h2>{i+1}. {esc(it["title"])}</h2><p class="meta">{esc(it["kind"])} · since {esc(it["since"])} · say: {" / ".join("<code>" + esc(a) + "</code>" for a in it["actions"])}</p>'
                + (f'<p class="why">{esc(it["why"])}</p>' if it.get("why") else "")
                + (f'<pre>{esc(it["draft"])}</pre>' if it.get("draft") else "")
                + (f'<details><summary>{len(it["list"])} recipients</summary><ul>' + "".join(f"<li>{esc(x)}</li>" for x in it["list"]) + "</ul></details>" if it.get("list") else "")
                + "</section>")
page = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Decisions · Safe Schools Project</title><link rel="stylesheet" href="/kids/site.css">
<style>.wrap{{max-width:900px}}.d{{background:#fff;border:1px solid #D9DEE8;border-radius:6px;padding:1rem 1.2rem;margin:1rem 0}}.d h2{{margin:.2rem 0 .4rem;font-size:1.15rem}}.meta{{color:#5A6577;font-size:.85rem;margin:0 0 .5rem}}.why{{font-size:.95rem;margin:.3rem 0 .6rem}}pre{{white-space:pre-wrap;background:#F5F7FA;border:1px solid #E8ECF1;border-radius:4px;padding:.7rem .9rem;font:14px/1.5 ui-monospace,Menlo,monospace;max-height:420px;overflow:auto}}details{{font-size:.9rem}}summary{{cursor:pointer;color:#5A6577}}</style></head>
<body><main class="wrap"><h1>Decisions</h1><p class="meta">{len(items)} waiting as of {esc(now.strftime('%A %B %-d, %-I:%M %p'))}. Answer by number, by text or in chat: "3 send", "4 edit: ...", "release board TX,GA", "7 go". <a href="/kids/ops/">Status</a> · <a href="/kids/ops/crm.html">CRM</a> · <a href="/kids/game/">Scoreboard</a></p>
{"".join(rows) or "<p>Nothing waiting.</p>"}
</main></body></html>"""
os.makedirs(os.path.join(ROOT, "site/ops"), exist_ok=True)
open(os.path.join(ROOT, "site/ops/decisions.html"), "w").write(page)
print(f"{len(items)} decisions")
for l in lines: print("  " + l)
