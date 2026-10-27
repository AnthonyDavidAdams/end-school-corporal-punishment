"""The campaign CRM: one page, every district we have talked to, where each one stands, what happened, and what is next.
Built from requests.json, the record, the board-member harvest, tagged-link clicks and the certificate log.
Writes site/ops/crm.html (noindex) and site/data/crm.json. Run by the cycle after ops_page; publish.sh deploys it.

  python3 tools/crm.py"""
import json, os, glob, re, html, datetime, collections, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "tools/outreach"))
H = html.escape

def ts(x):
    try: return datetime.datetime.fromisoformat(str(x)[:19])
    except Exception:
        try:
            from email.utils import parsedate_to_datetime; return parsedate_to_datetime(str(x)).replace(tzinfo=None)
        except Exception: return None

rs = json.load(open(os.path.join(ROOT, "data/outreach/requests.json")))
rec = {}
import yaml
for f in glob.glob(os.path.join(ROOT, "data/districts/*.yaml")):
    for d in yaml.safe_load(open(f))["districts"]:
        if d.get("nces_id"): rec[str(d["nces_id"])] = d
boards = collections.defaultdict(list)
bf = os.path.join(ROOT, "data/contacts/board-members.jsonl")
if os.path.exists(bf):
    for l in open(bf):
        try: row = json.loads(l)
        except Exception: continue
        for m in row.get("members") or []: boards[str(row.get("nces_id"))].append(m)
clicks = {}
cf = os.path.join(ROOT, "data/outreach/clicks.json")
if os.path.exists(cf):
    for c in json.load(open(cf)): clicks.setdefault(str(c.get("nces_id")), []).append(c)

# group everything by district
by = collections.defaultdict(lambda: {"requests": [], "events": []})
for r in rs:
    key = str(r.get("nces_id") or f"{r['state']}|{r['name']}")
    g = by[key]; g["requests"].append(r); g["state"] = r["state"]; g["name"] = r["name"]; g["nces_id"] = r.get("nces_id"); g["to"] = g.get("to") or r.get("to"); g["superintendent"] = g.get("superintendent") or r.get("superintendent")
    kind = r.get("kind") or "policy"
    if r.get("sent_at"): g["events"].append((ts(r["sent_at"]), "us", f"sent: {kind}", (r.get("body") or "")[:200]))
    for e in r.get("replies") or []:
        if e.get("from") == "us": continue
        when = ts(e.get("date") or e.get("at")); g["events"].append((when, "them", e.get("kind") or "reply", (e.get("action") or "")[:220]))
    for m in r.get("our_messages") or []:
        g["events"].append((ts(m.get("at")), "us", "reply" + (" (Anthony)" if m.get("by") == "anthony" else ""), (m.get("text") or "")[:220]))

STAGES = ["Needs you", "Certified", "Adopted", "Invited", "Recorded", "Replied", "Asked", "Bounced"]
def stage(g):
    reqs = g["requests"]; kinds = {r.get("kind") or "policy" for r in reqs}; statuses = {r["status"] for r in reqs}
    d = rec.get(str(g.get("nces_id")), {})
    if "needs_review" in statuses: return "Needs you"
    if any(r.get("kind") == "certificate" and r["status"] == "sent" for r in reqs): return "Certified"
    if d.get("status") == "bans" and any(r.get("kind") == "align" for r in reqs): return "Adopted"
    if "align" in kinds: return "Invited"
    if d.get("status") in ("bans", "allows", "consent_required") and any(r.get("replies") for r in reqs): return "Recorded"
    if any(r.get("replies") for r in reqs): return "Replied"
    if "bounced" in statuses: return "Bounced"
    return "Asked"

def next_action(g, st):
    d = rec.get(str(g.get("nces_id")), {})
    if st == "Needs you": return "Read the thread and decide"
    if st == "Bounced": return "Find another address (crew task)"
    if st == "Asked":
        last = max((ev[0] for ev in g["events"] if ev[0]), default=None)
        return "Nudge sent; wait" if any(r.get("followup_sent_at") for r in g["requests"]) else "Follow-up due after 10 business days"
    if st == "Replied": return "Record from what they sent"
    if st == "Recorded":
        if d.get("status") == "bans": return "Certificate (momentum pass)"
        if d.get("status") in ("allows", "consent_required"): return "Invite to align (board brief)"
        return "Ask for the policy document"
    if st == "Invited": return "Board-member note two weeks after the invitation" if boards.get(str(g.get("nces_id"))) else "Harvest board members"
    if st == "Adopted": return "Certificate"
    if st == "Certified": return "Ask for a 30-second video and the case study"
    return ""

rows = []
for key, g in by.items():
    st = stage(g); d = rec.get(str(g.get("nces_id")), {})
    evs = sorted([e for e in g["events"] if e[0]], key=lambda e: e[0])
    last = evs[-1] if evs else None
    last_them = [e for e in evs if e[1] == "them"]
    rows.append({"key": key, "state": g["state"], "name": g["name"], "nces_id": g.get("nces_id"), "to": g.get("to"), "superintendent": g.get("superintendent"),
                 "stage": st, "record": d.get("status") or "", "policy_code": d.get("policy_code") or "", "quote": (d.get("quote") or "")[:160],
                 "last_at": last[0].strftime("%Y-%m-%d %H:%M") if last else "", "last_who": last[1] if last else "", "last_what": last[3] if last else "",
                 "their_last": last_them[-1][0].strftime("%Y-%m-%d") if last_them else "", "messages": len(evs), "board_members": len(boards.get(str(g.get("nces_id")), [])),
                 "board_emails": sum(1 for m in boards.get(str(g.get("nces_id")), []) if m.get("email")), "clicks": sum(c.get("visits", 0) for c in clicks.get(str(g.get("nces_id")), [])),
                 "next": next_action(g, st), "kinds": sorted({r.get("kind") or "policy" for r in g["requests"]}),
                 "timeline": [{"at": e[0].strftime("%Y-%m-%d %H:%M"), "who": e[1], "what": e[2], "text": e[3]} for e in evs]})
rows.sort(key=lambda x: (STAGES.index(x["stage"]), x["last_at"]), reverse=False)
rows.sort(key=lambda x: x["last_at"], reverse=True); rows.sort(key=lambda x: STAGES.index(x["stage"]))
counts = collections.Counter(x["stage"] for x in rows)
os.makedirs(os.path.join(ROOT, "site/data"), exist_ok=True); os.makedirs(os.path.join(ROOT, "site/ops"), exist_ok=True)
json.dump({"built": datetime.datetime.now().isoformat(timespec="seconds"), "counts": counts, "rows": rows}, open(os.path.join(ROOT, "site/data/crm.json"), "w"))

now = datetime.datetime.now()
page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Safe Schools CRM</title>
<style>
:root{{--navy:#0B2A45;--blue:#0D6CB9;--orange:#F26A3D;--ink:#1b2a38;--dim:#6a7a8a;--line:#dfe6ec;--bg:#f6f8fa}}
*{{box-sizing:border-box}}body{{margin:0;font:15px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}}
header{{background:var(--navy);color:#fff;padding:14px 20px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}}header h1{{font-size:18px;margin:0}}header .m{{color:#bfd8ee;font-size:13px}}
.stages{{display:flex;gap:8px;flex-wrap:wrap;padding:12px 20px}}.stages button{{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;cursor:pointer;font:inherit}}.stages button.on{{background:var(--blue);color:#fff;border-color:var(--blue)}}.stages b{{margin-left:6px}}
.tools{{display:flex;gap:10px;padding:0 20px 10px;flex-wrap:wrap}}.tools input,.tools select{{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px}}
table{{width:100%;border-collapse:collapse;background:#fff}}th,td{{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:14px}}th{{position:sticky;top:0;background:#fff;cursor:pointer;color:var(--dim);font-weight:600}}
tr.row{{cursor:pointer}}tr.row:hover{{background:#eef4fa}}.tag{{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#e8eef4;color:var(--navy)}}
.tag.needs{{background:#ffe3d6;color:#8a2d0b}}.tag.cert{{background:#d9f2e3;color:#0f5132}}.tag.adopt{{background:#d9f2e3;color:#0f5132}}.tag.invite{{background:#dbe9f7;color:#0b3d6b}}.tag.rec{{background:#e8eef4}}.tag.bounce{{background:#f2d9d9;color:#7a1d1d}}
.rec{{font-size:12px;color:var(--dim)}}.detail td{{background:#fbfcfd;padding:12px 18px}}.tl{{margin:0;padding:0;list-style:none}}.tl li{{padding:4px 0;border-left:3px solid var(--line);padding-left:10px;margin-left:4px}}.tl li.them{{border-color:var(--orange)}}.tl li.us{{border-color:var(--blue)}}.tl .w{{color:var(--dim);font-size:12px}}
.next{{font-weight:600;color:var(--navy)}}.n{{text-align:right;font-variant-numeric:tabular-nums}}.foot{{padding:16px 20px;color:var(--dim);font-size:12px}}
@media(max-width:800px){{th:nth-child(6),td:nth-child(6),th:nth-child(7),td:nth-child(7){{display:none}}}}
</style></head><body>
<header><h1>Safe Schools CRM</h1><span class="m">{len(rows):,} districts in conversation · built {H(now.strftime('%b %-d, %-I:%M %p'))} · <a href="/kids/ops/" style="color:#fff">ops</a> · <a href="/kids/" style="color:#fff">record</a></span></header>
<div class="stages" id="stages"><button class="on" data-s="">All<b>{len(rows)}</b></button>{"".join(f'<button data-s="{H(s)}">{H(s)}<b>{counts.get(s,0)}</b></button>' for s in STAGES)}</div>
<div class="tools"><input id="q" placeholder="Search district, state, email, person" size="40"><select id="st"><option value="">Every state</option>{"".join(f'<option>{s}</option>' for s in sorted({x["state"] for x in rows}))}</select><select id="rec"><option value="">Any record</option><option>bans</option><option>allows</option><option>consent_required</option><option>silent</option><option>unknown</option></select></div>
<table id="t"><thead><tr><th data-k="stage">Stage</th><th data-k="state">St</th><th data-k="name">District</th><th data-k="record">Record</th><th data-k="last_at">Last touch</th><th data-k="their_last">They wrote</th><th data-k="board_emails" class="n">Board emails</th><th data-k="clicks" class="n">Clicks</th><th data-k="next">Next</th></tr></thead><tbody id="b"></tbody></table>
<p class="foot">Stages: Needs you (a thread parked for a decision) · Certified · Adopted (policy now prohibits after an invitation) · Invited (alignment letter sent) · Recorded (we have their policy) · Replied · Asked · Bounced. Click a row for the timeline. Data: requests.json, the district record, the board-member harvest, tagged-link clicks.</p>
<script>
const ROWS={json.dumps(rows)};const CL={{"Needs you":"needs","Certified":"cert","Adopted":"adopt","Invited":"invite","Recorded":"rec","Bounced":"bounce"}};
let stage="",q="",st="",rc="",sortK="",sortD=1;
function esc(s){{return String(s==null?"":s).replace(/[&<>"]/g,c=>({{"&":"&amp;","<":"&lt;","&gt;":"&gt;",'"':"&quot;"}}[c]||c))}}
function render(){{const b=document.getElementById("b");let rows=ROWS.filter(r=>(!stage||r.stage===stage)&&(!st||r.state===st)&&(!rc||r.record===rc)&&(!q||(r.name+" "+r.state+" "+(r.to||"")+" "+(r.superintendent||"")).toLowerCase().includes(q)));
 if(sortK)rows=rows.slice().sort((a,b)=>(a[sortK]>b[sortK]?1:a[sortK]<b[sortK]?-1:0)*sortD);
 b.innerHTML=rows.map((r,i)=>`<tr class="row" data-i="${{i}}"><td><span class="tag ${{CL[r.stage]||""}}">${{esc(r.stage)}}</span></td><td>${{esc(r.state)}}</td><td><b>${{esc(r.name)}}</b><div class="rec">${{esc(r.superintendent||"")}} · ${{esc(r.to||"")}}</div></td><td>${{esc(r.record)}}<div class="rec">${{esc(r.policy_code)}}</div></td><td>${{esc(r.last_at)}}<div class="rec">${{esc(r.last_who)}}: ${{esc((r.last_what||"").slice(0,70))}}</div></td><td>${{esc(r.their_last)}}</td><td class="n">${{r.board_emails}}/${{r.board_members}}</td><td class="n">${{r.clicks}}</td><td class="next">${{esc(r.next)}}</td></tr>`).join("");
 b.querySelectorAll("tr.row").forEach(tr=>tr.addEventListener("click",()=>{{const r=rows[+tr.dataset.i];const nx=tr.nextElementSibling;if(nx&&nx.classList.contains("detail")){{nx.remove();return}}const d=document.createElement("tr");d.className="detail";const gm="https://mail.google.com/mail/u/0/#search/"+encodeURIComponent(r.to||r.name);d.innerHTML=`<td colspan="9"><div><b>${{esc(r.name)}}</b> · record: ${{esc(r.record)}} ${{esc(r.policy_code)}} · <a href="${{gm}}" target="_blank" rel="noopener">open in Gmail</a> · <a href="/kids/state/${{esc(r.state)}}/" target="_blank">state page</a></div>${{r.quote?`<div class="rec">“${{esc(r.quote)}}”</div>`:""}}<ul class="tl">${{r.timeline.map(e=>`<li class="${{e.who}}"><span class="w">${{esc(e.at)}} · ${{esc(e.who==="us"?"us":"them")}} · ${{esc(e.what)}}</span><br>${{esc(e.text)}}</li>`).join("")}}</ul></td>`;tr.after(d);}}));}}
document.querySelectorAll("#stages button").forEach(b=>b.addEventListener("click",()=>{{document.querySelectorAll("#stages button").forEach(x=>x.classList.remove("on"));b.classList.add("on");stage=b.dataset.s;render()}}));
document.getElementById("q").addEventListener("input",e=>{{q=e.target.value.toLowerCase();render()}});document.getElementById("st").addEventListener("change",e=>{{st=e.target.value;render()}});document.getElementById("rec").addEventListener("change",e=>{{rc=e.target.value;render()}});
document.querySelectorAll("th[data-k]").forEach(th=>th.addEventListener("click",()=>{{if(sortK===th.dataset.k)sortD*=-1;else{{sortK=th.dataset.k;sortD=1}}render()}}));
render();
</script></body></html>"""
open(os.path.join(ROOT, "site/ops/crm.html"), "w").write(page)
print(f"crm: {len(rows)} districts; " + ", ".join(f"{s} {counts.get(s,0)}" for s in STAGES))
