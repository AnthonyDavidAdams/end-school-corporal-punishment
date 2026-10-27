"""The decisions desk: one page (site/ops/decisions.html, noindex) and one JSON (data/outreach/decisions.json)
listing everything that is waiting on Anthony, numbered, with the drafted text where there is one. Built after
the CRM in every cycle. Anthony answers by number in chat ("3 send, 5 skip, release board TX"), or with the
buttons on the page, which post to site/ops/decide.php; the next outreach cycle applies them (run.py decide).

Nothing waits forever. A reply with a draft, or a held batch, auto-approves AUTO_HOURS after the desk first
listed it unless Anthony holds it, and the referee re-reads a draft before an auto-send. Items a person must
answer (a fee, a legal letter, a demand to stop writing, a residency rule, a standing to-do) carry no clock.

  python3 tools/decisions.py"""
import json, os, sys, re, html, datetime, collections, hashlib
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "tools/outreach"))
try: import run as outreach
except Exception: outreach = None
esc = html.escape
AUTO_HOURS = 24
STATE = os.path.join(ROOT, "data/outreach/decisions-state.json")
reqs = json.load(open(os.path.join(ROOT, "data/outreach/requests.json")))
extra = json.load(open(os.path.join(ROOT, "data/outreach/decisions-extra.json"))) if os.path.exists(os.path.join(ROOT, "data/outreach/decisions-extra.json")) else []
state = json.load(open(STATE)) if os.path.exists(STATE) else {}
now = datetime.datetime.now()
items = []
# what only a person can answer; a draft whose reason or whose reply mentions these never auto-sends
PERSON = re.compile(r"\bfee\b|\$\s*\d|residen|attorney|lawyer|legal (action|counsel|letter)|threat|complaint|cease|desist|stop (writing|contacting|emailing)|do not contact|unsubscribe|harass|invoice|payment", re.I)

def preview(r):
    try: return outreach.body_for(r) if outreach else (r.get("body") or "")
    except Exception as e: return r.get("body") or f"(no preview: {e})"

def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]

def clock(it, auto):
    """First time the desk lists an item, the clock starts; the state file remembers. Returns the ISO time it
    auto-approves, or None when it waits for a person or Anthony has held it."""
    st = state.setdefault(it["id"], {})
    st.setdefault("first_seen", now.isoformat(timespec="minutes"))
    if not auto or st.get("hold") or st.get("auto_tried") or st.get("auto_done"): return None
    return (datetime.datetime.fromisoformat(st["first_seen"]) + datetime.timedelta(hours=AUTO_HOURS)).isoformat(timespec="minutes")

# 1. replies that need a decision, each with the draft the writer proposed
for r in sorted([x for x in reqs if x["status"] == "needs_review"], key=lambda x: x.get("last_reply_at") or ""):
    m = (r.get("replies") or [{}])[-1]
    draft = m.get("suggested") or ""
    why = m.get("why") or m.get("action") or ""
    it = {"id": f"reply:{r['id']}:{hashlib.sha1((m.get('message_id') or m.get('file') or '').encode()).hexdigest()[:8]}", "kind": "reply",
          "title": f"{r['name']}, {r['state']}: {m.get('kind', 'reply')} from {m.get('from', '?')}", "since": (m.get("date") or r.get("last_reply_at") or "")[:16],
          "why": why, "draft": draft, "request": r["id"], "actions": ["send the draft", "edit", "skip", "close"]}
    person = not draft or bool(PERSON.search(why + " " + (m.get("text") or "")[:1500]))
    it["auto_at"] = clock(it, not person)
    it["auto_what"] = "send the draft (the referee reads it again first)" if it["auto_at"] else None
    it["waits"] = "a fee, a legal note, a residency rule or a stop request: a person answers this" if person and draft else ("no draft to send" if not draft else None)
    items.append(it)
# 2. held batches, grouped by kind, with one preview and the list
held = collections.defaultdict(list)
for r in reqs:
    if r["status"] == "held": held[r.get("kind", "policy")].append(r)
LABEL = {"align": "Safe School invitations to superintendents", "board_note": "Board-member notes with the film link", "neighbor": "Neighbor asks (next to a district that moved)", "policy": "First asks", "apology": "Apologies"}
for k, rs in held.items():
    rs.sort(key=lambda x: (x["state"], x["name"]))
    by_state = collections.Counter(x["state"] for x in rs)
    variants = collections.Counter(x.get("variant") or "A" for x in rs)
    it = {"id": f"batch:{k}", "kind": "batch", "title": f"{len(rs)} {LABEL.get(k, k)} held ({', '.join(f'{s} {c}' for s, c in sorted(by_state.items()))}; variants {dict(variants)})", "since": min(x.get("queued_at") or "" for x in rs)[:10],
          "why": "A new message kind or batch waits until you have seen it.", "draft": preview(rs[0]), "list": [f"{x['state']} {x['name']}" + (f" ({x.get('member')})" if x.get("member") else "") + f" -> {x['to']}" + (f" [{x.get('variant')}]" if x.get("variant") else "") for x in rs],
          "actions": [f"release {k}", f"release {k} <STATES>", "edit the text", "drop"], "batch": k}
    it["auto_at"] = clock(it, True); it["auto_what"] = f"release all {len(rs)}" if it["auto_at"] else None; it["waits"] = None
    items.append(it)
# 3. standing items: a person's to-do, no clock
for e in extra:
    it = {"id": f"standing:{slug(e['title'])}", "kind": "standing", "title": e["title"], "since": e.get("since", ""), "why": e.get("detail", ""), "draft": "", "actions": ["go", "skip", "later"]}
    clock(it, False); it["auto_at"] = None; it["auto_what"] = None; it["waits"] = "yours to start"
    if state.get(it["id"], {}).get("go"): it["why"] = f"GO given {state[it['id']]['go'][:16]}; Claude picks it up. " + it["why"]
    items.append(it)

# forget state for items no longer listed
live = {it["id"] for it in items}
state = {k: v for k, v in state.items() if k in live}
json.dump(state, open(STATE, "w"), indent=1)

lines = [f"{i+1}. {it['title']}" for i, it in enumerate(items)]
json.dump({"as_of": now.isoformat(timespec="minutes"), "count": len(items), "auto_hours": AUTO_HOURS, "lines": lines, "items": [{k: v for k, v in it.items() if k != "draft"} for it in items]}, open(os.path.join(ROOT, "data/outreach/decisions.json"), "w"), indent=1)

def when(iso):
    t = datetime.datetime.fromisoformat(iso); d = t - now
    if d.total_seconds() <= 0: return "on the next cycle"
    h = int(d.total_seconds() // 3600); mnt = int(d.total_seconds() % 3600 // 60)
    return f"in {h}h {mnt}m ({t.strftime('%a %-I:%M %p')})"

rows = []
for i, it in enumerate(items):
    held_now = state.get(it["id"], {}).get("hold")
    if held_now: status = '<span class="tag hold">held by you, no clock</span>'
    elif it.get("auto_at"): status = f'<span class="tag auto">auto: {esc(it["auto_what"])} {esc(when(it["auto_at"]))}</span>'
    else: status = f'<span class="tag waits">{esc(it.get("waits") or "waits for you")}</span>'
    btns = {"reply": [("approve", "Send the draft"), ("retry", "Redraft"), ("hold", "Hold"), ("drop", "Close, no reply")],
            "batch": [("approve", "Release all"), ("hold", "Hold"), ("drop", "Drop the batch")],
            "standing": [("go", "Go"), ("skip", "Skip")]}[it["kind"]]
    rows.append(f'<section class="d" data-id="{esc(it["id"])}"><h2>{i+1}. {esc(it["title"])}</h2><p class="meta">{esc(it["kind"])} · since {esc(it["since"])} · {status}</p>'
                + (f'<p class="why">{esc(it["why"])}</p>' if it.get("why") else "")
                + (f'<pre>{esc(it["draft"])}</pre>' if it.get("draft") else "")
                + (f'<details><summary>{len(it["list"])} recipients</summary><ul>' + "".join(f"<li>{esc(x)}</li>" for x in it["list"]) + "</ul></details>" if it.get("list") else "")
                + '<p class="btns">' + "".join(f'<button data-action="{a}">{esc(label)}</button>' for a, label in btns) + f'<span class="said"></span></p><p class="meta say">in chat: {" / ".join("<code>" + esc(a) + "</code>" for a in it["actions"])}</p></section>')
page = f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Decisions · Safe Schools Project</title><link rel="stylesheet" href="/kids/site.css">
<style>.wrap{{max-width:900px}}.d{{background:#fff;border:1px solid #D9DEE8;border-radius:6px;padding:1rem 1.2rem;margin:1rem 0}}.d h2{{margin:.2rem 0 .4rem;font-size:1.15rem}}.meta{{color:#5A6577;font-size:.85rem;margin:0 0 .5rem}}.why{{font-size:.95rem;margin:.3rem 0 .6rem}}pre{{white-space:pre-wrap;background:#F5F7FA;border:1px solid #E8ECF1;border-radius:4px;padding:.7rem .9rem;font:14px/1.5 ui-monospace,Menlo,monospace;max-height:420px;overflow:auto}}details{{font-size:.9rem}}summary{{cursor:pointer;color:#5A6577}}
.tag{{display:inline-block;padding:.1rem .5rem;border-radius:3px;font-size:.8rem}}.tag.auto{{background:#FFF4D6;color:#6B4E00}}.tag.waits{{background:#EEF1F5;color:#3B4656}}.tag.hold{{background:#E6F0FF;color:#1F3B73}}
.btns{{margin:.6rem 0 .2rem;display:none;flex-wrap:wrap;gap:.4rem;align-items:center}}body.keyed .btns{{display:flex}}.btns button{{font:inherit;font-size:.9rem;padding:.35rem .7rem;border:1px solid #B8C0CC;border-radius:4px;background:#fff;cursor:pointer}}.btns button[data-action=approve],.btns button[data-action=go]{{background:#1F6B3A;color:#fff;border-color:#1F6B3A}}.btns button:disabled{{opacity:.5;cursor:default}}.said{{font-size:.85rem;color:#1F6B3A;margin-left:.3rem}}.d.queued{{border-color:#1F6B3A}}.say{{margin-top:.2rem}}#key{{font-size:.85rem;color:#5A6577}}</style></head>
<body><main class="wrap"><h1>Decisions</h1><p class="meta">{len(items)} waiting as of {esc(now.strftime('%A %B %-d, %-I:%M %p'))}. Anything with a clock goes ahead on its own after {AUTO_HOURS} hours unless you hold it; buttons are applied by the next 15-minute cycle. In chat: "3 send", "4 edit: ...", "release board TX,GA", "7 go". <a href="/kids/ops/">Status</a> · <a href="/kids/ops/crm.html">CRM</a> · <a href="/kids/game/">Scoreboard</a></p>
<p id="key">Buttons appear when you open this page from the link in your recap text.</p>
{"".join(rows) or "<p>Nothing waiting.</p>"}
</main>
<script>
(function(){{
  var m=location.hash.match(/k=([A-Za-z0-9_\\-]+)/); var k=null;
  try{{ if(m){{localStorage.setItem("opsk",m[1]); history.replaceState(null,"",location.pathname);}} k=localStorage.getItem("opsk"); }}catch(e){{}}
  if(!k) return;
  document.body.classList.add("keyed"); document.getElementById("key").textContent="Buttons post to the queue; the next cycle applies them.";
  var api="/kids/ops/decide.php";
  function mark(card,text){{ card.classList.add("queued"); card.querySelector(".said").textContent=text; card.querySelectorAll("button").forEach(function(b){{b.disabled=true;}}); }}
  fetch(api+"?token="+encodeURIComponent(k)).then(function(r){{return r.ok?r.json():[]}}).then(function(q){{
    (q||[]).forEach(function(x){{ var c=document.querySelector('.d[data-id="'+x.id+'"]'); if(c) mark(c,"queued: "+x.action); }});
  }}).catch(function(){{}});
  document.querySelectorAll(".btns button").forEach(function(b){{
    b.addEventListener("click",function(){{
      var card=b.closest(".d"); var id=card.getAttribute("data-id"); var action=b.getAttribute("data-action");
      var note=""; if(action==="retry"||action==="hold"){{ note=prompt(action==="retry"?"Anything the redraft should do differently? (optional)":"Why hold? (optional)")||""; }}
      b.disabled=true;
      fetch(api,{{method:"POST",headers:{{"Content-Type":"application/json"}},body:JSON.stringify({{token:k,id:id,action:action,note:note}})}})
        .then(function(r){{ if(!r.ok) throw new Error(r.status); return r.json(); }})
        .then(function(){{ mark(card,"queued: "+action); }})
        .catch(function(e){{ b.disabled=false; card.querySelector(".said").textContent="did not queue ("+e.message+")"; }});
    }});
  }});
}})();
</script></body></html>"""
os.makedirs(os.path.join(ROOT, "site/ops"), exist_ok=True)
open(os.path.join(ROOT, "site/ops/decisions.html"), "w").write(page)
print(f"{len(items)} decisions")
for l in lines: print("  " + l)
