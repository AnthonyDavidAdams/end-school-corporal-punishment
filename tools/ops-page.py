"""Mission control: one page that shows the whole machine at a glance.

Rebuilt by the 15-minute outreach job and by every publish; served at earthpilot.org/kids/ops/. It is
computed from the same files the machine runs on, so it cannot drift from the truth: the record
(data/districts), the correspondence file (data/outreach/requests.json), the agency file, the portal
manifest and its nightly outputs, and the job logs. No addresses are published; officials appear by
district only.

    python3 tools/ops-page.py          -> site/ops/index.html
"""
import collections, datetime, html, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools/outreach"))
import track  # noqa: E402

esc = lambda s: html.escape(str(s if s is not None else ""))
now = datetime.datetime.now()
today = now.date().isoformat()


def record():
    out = subprocess.run(["node", "-e", '''
const yaml=require("./tools/node_modules/yaml");const fs=require("fs");const by={};let t=0,q=0;const st={};
for(const f of fs.readdirSync("data/districts").filter(f=>f.endsWith(".yaml"))){const d=yaml.parse(fs.readFileSync("data/districts/"+f,"utf8"));for(const r of (Array.isArray(d)?d:d.districts)){t++;const s=r.state||f.slice(0,2);by[s]=by[s]||{total:0,quoted:0,bans:0,allows:0,consent:0,today:0};by[s].total++;if(r.quote){q++;by[s].quoted++;st[r.status]=(st[r.status]||0)+1;if(r.status==="bans")by[s].bans++;else if(r.status==="allows")by[s].allows++;else if(r.status==="consent_required")by[s].consent++;if(String(r.last_verified)==="%s")by[s].today++;}}}
console.log(JSON.stringify({total:t,quoted:q,status:st,by}));''' % today], cwd=ROOT, capture_output=True, text=True).stdout
    return json.loads(out)


def portals():
    rows = []
    man = open(os.path.join(ROOT, "tools/portals/nightly.sh")).read()
    for line in man.splitlines():
        m = re.match(r"^([A-Z]{2})\|([^|]+)\|([^|]+)\|", line.strip())
        if not m: continue
        st, harv, jsonl = m.groups()
        p = os.path.join(ROOT, jsonl)
        n = sum(1 for l in open(p) if l.strip()) if os.path.exists(p) else 0
        last = None
        for day in sorted(os.listdir(os.path.join(ROOT, "out/portals")), reverse=True) if os.path.isdir(os.path.join(ROOT, "out/portals")) else []:
            if os.path.exists(os.path.join(ROOT, "out/portals", day, f"{st}-records.json")):
                last = (day, len(json.load(open(os.path.join(ROOT, "out/portals", day, f"{st}-records.json"))))); break
        rows.append({"state": st, "harvester": os.path.basename(harv), "rows": n, "last_new": last})
    return rows


def nightly_tail():
    p = "/tmp/escp-nightly.out"
    if not os.path.exists(p): return []
    lines = [l.rstrip() for l in open(p, errors="ignore").read().splitlines()[-40:]]
    return lines


def outreach_tail():
    p = "/tmp/escp-outreach.out"
    if not os.path.exists(p): return []
    keep = []
    for l in open(p, errors="ignore").read().splitlines()[-400:]:
        if re.search(r"0 sent, 0 still|0 new replies|0 nudges|tidy: 0|sent-mail scan", l): continue
        # addresses are not published
        l = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+", "[address]", l)
        keep.append(l)
    return keep[-30:]


def main():
    rec = record(); reqs = track.load(); rows = track.board(reqs)
    agencies = [r for r in reqs if r.get("kind") == "state_doe"]
    forms = []
    fp = os.path.join(ROOT, "data/outreach/agency-forms.jsonl")
    if os.path.exists(fp):
        forms = [json.loads(l) for l in open(fp) if l.strip()]
    sent_today = sum(1 for r in reqs if (r.get("sent_at") or "").startswith(today))
    replies_today = sum(1 for r in reqs for e in r.get("replies") or [] if e.get("from") != "us" and today[5:] in str(e.get("date", "")) and str(now.year) in str(e.get("date", "")))
    ours_today = sum(1 for r in reqs for e in r.get("replies") or [] if e.get("our_reply") and today in str(r.get("last_reply_at", "")))
    pending = sum(1 for r in reqs if r.get("status") == "pending")
    kinds = collections.Counter(r.get("kind", "policy") for r in reqs)
    victories = [json.loads(l) for l in open(os.path.join(ROOT, "data/victories.jsonl")) if l.strip()] if os.path.exists(os.path.join(ROOT, "data/victories.jsonl")) else []
    corrections = [json.loads(l) for l in open(os.path.join(ROOT, "data/corrections.jsonl")) if l.strip()] if os.path.exists(os.path.join(ROOT, "data/corrections.jsonl")) else []

    by = sorted(rec["by"].items(), key=lambda kv: -(kv[1]["total"] - kv[1]["quoted"]))
    H = []
    H.append(f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mission control · Safe Schools Project</title><meta name="robots" content="noindex">
<meta property="og:title" content="Mission control · Safe Schools Project"><meta property="og:description" content="The record, the correspondence, the agencies and the harvesters, as they stand right now."><meta property="og:type" content="website"><meta property="og:url" content="https://earthpilot.org/kids/ops/"><meta property="og:site_name" content="End School Corporal Punishment"><meta property="og:image" content="https://earthpilot.org/kids/assets/og.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Mission control · Safe Schools Project"><meta name="twitter:description" content="The record, the correspondence, the agencies and the harvesters, as they stand right now."><meta name="twitter:image" content="https://earthpilot.org/kids/assets/og.png">
<meta http-equiv="refresh" content="300">
<style>
:root{{--bg:#0B0F1E;--panel:#121832;--line:#232B4A;--ink:#E8ECF1;--mute:#8B95A5;--dim:#5E6A8A;--gold:#FDE68A;--green:#43E08A;--red:#FF6B6B;--amber:#FFB000;--blue:#7DD3FC}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 'IBM Plex Mono',ui-monospace,Menlo,monospace;padding:20px 16px 60px}}
h1{{font-size:20px;margin:0 0 .2rem;font-weight:600}}h2{{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin:0 0 .6rem;font-weight:500}}
.meta{{color:var(--dim);margin:0 0 1.2rem}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}}
.panel{{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;min-width:0}}.wide{{grid-column:1/-1}}
.big{{display:flex;gap:18px;flex-wrap:wrap;margin:.2rem 0 .6rem}}.big div{{min-width:90px}}.big b{{display:block;font-size:26px;font-weight:600;line-height:1.1}}.big span{{color:var(--mute);font-size:12px}}
table{{border-collapse:collapse;width:100%}}td,th{{padding:.22rem .5rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-weight:400}}th{{color:var(--mute);font-size:11px;letter-spacing:.08em;text-transform:uppercase}}td.n{{text-align:right;font-variant-numeric:tabular-nums}}
.g{{color:var(--green)}}.r{{color:var(--red)}}.a{{color:var(--amber)}}.m{{color:var(--mute)}}.b{{color:var(--blue)}}
pre{{margin:0;white-space:pre-wrap;word-break:break-word;color:var(--mute);font-size:12px;max-height:380px;overflow:auto}}
.bar{{height:6px;background:#1b2140;border-radius:3px;overflow:hidden;margin-top:3px}}.bar i{{display:block;height:100%;background:var(--green)}}
a{{color:var(--blue);text-decoration:none}}a:hover{{text-decoration:underline}}
</style></head><body>
<h1>Mission control</h1><p class="meta">Safe Schools Project · rebuilt {esc(now.strftime('%Y-%m-%d %H:%M'))} local · refreshes itself every 5 minutes · <a href="/kids/live/">flight board</a> · <a href="/kids/">the record</a></p>
<div class="grid">""")

    # The record
    unq = rec["total"] - rec["quoted"]
    H.append(f"""<div class="panel"><h2>The record</h2><div class="big">
<div><b>{rec['total']:,}</b><span>districts</span></div><div><b class="g">{rec['quoted']:,}</b><span>policy found, exact sentence on file</span></div><div><b class="a">{unq:,}</b><span>policy not found yet</span></div></div>
<div class="bar"><i style="width:{100*rec['quoted']/max(rec['total'],1):.1f}%"></i></div>
<p class="m" style="margin:.6rem 0 0">Of those found: {rec['status'].get('bans',0):,} prohibit it · {rec['status'].get('allows',0):,} permit it · {rec['status'].get('consent_required',0):,} permit it only with a parent's consent</p></div>""")

    # Today
    H.append(f"""<div class="panel"><h2>Today</h2><div class="big">
<div><b>{sent_today}</b><span>asks sent</span></div><div><b>{replies_today}</b><span>replies in</span></div><div><b>{sum(v['today'] for _, v in by):,}</b><span>policies found today</span></div><div><b class="a">{pending}</b><span>queued to send</span></div></div>
<p class="m" style="margin:.4rem 0 0">victories logged {len(victories)} · corrections {len(corrections)} · requests of every kind {sum(kinds.values())}</p></div>""")

    # Correspondence lanes
    H.append('<div class="panel"><h2>Correspondence</h2><table>')
    for key, title in track.STAGES:
        v = rows.get(key) or []
        if not v: continue
        cls = "r" if key == "needs_you" else "g" if key == "done" else ""
        H.append(f'<tr><td class="{cls}">{esc(title)}</td><td class="n">{len(v)}</td></tr>')
    H.append(f'</table><p class="m" style="margin:.5rem 0 0">{len(reqs)} districts and agencies written to · <a href="/kids/ops/board.html">full board</a></p></div>')

    # Agencies
    H.append('<div class="panel"><h2>State agencies</h2><table><tr><th>State</th><th>Route</th><th>Sent</th><th>Status</th></tr>')
    seen = set()
    for r in sorted(agencies, key=lambda x: x["state"]):
        seen.add(r["state"]); st, why = track.stage(r)
        H.append(f'<tr><td>{esc(r["state"])}</td><td class="m">email</td><td class="m">{esc((r.get("sent_at") or "")[:10])}</td><td>{esc(r.get("status"))}{(" · " + esc(r.get("promised_by"))) if r.get("promised_by") else ""}<br><span class="m">{esc(why)}</span></td></tr>')
    for f in forms:
        if f["state"] in seen or not f.get("submitted_at"): continue
        H.append(f'<tr><td>{esc(f["state"])}</td><td class="m">web form</td><td class="m">{esc(f["submitted_at"][:10])}</td><td>submitted<br><span class="m">{esc((f.get("confirmation") or "")[:80])}</span></td></tr>')
    H.append('</table></div>')

    # By state
    H.append('<div class="panel wide"><h2>By state: policies found and still missing</h2><table><tr><th>State</th><th class="n">Districts</th><th class="n">Found</th><th class="n">Missing</th><th class="n">Prohibit</th><th class="n">Permit</th><th class="n">Consent</th><th class="n">Today</th><th></th></tr>')
    for st, v in by:
        if v["total"] - v["quoted"] == 0 and v["today"] == 0: continue
        pct = 100 * v["quoted"] / max(v["total"], 1)
        H.append(f'<tr><td><a href="/kids/state/{esc(st)}/">{esc(st)}</a></td><td class="n">{v["total"]}</td><td class="n g">{v["quoted"]}</td><td class="n a">{v["total"]-v["quoted"]}</td><td class="n">{v["bans"]}</td><td class="n">{v["allows"]}</td><td class="n">{v["consent"]}</td><td class="n b">{v["today"] or ""}</td><td style="min-width:120px"><div class="bar"><i style="width:{pct:.0f}%"></i></div></td></tr>')
    H.append('</table></div>')

    # Harvesters
    H.append('<div class="panel"><h2>Portal harvesters (nightly)</h2><table><tr><th>State</th><th>Reader</th><th class="n">Rows</th><th>Last new records</th></tr>')
    for p in portals():
        ln = f'{p["last_new"][0]} · {p["last_new"][1]}' if p["last_new"] else "none yet"
        H.append(f'<tr><td>{esc(p["state"])}</td><td class="m">{esc(p["harvester"])}</td><td class="n">{p["rows"]}</td><td class="m">{esc(ln)}</td></tr>')
    H.append('</table></div>')

    # Logs
    H.append('<div class="panel"><h2>Last night</h2><pre>' + esc("\n".join(nightly_tail())) + '</pre></div>')
    H.append('<div class="panel wide"><h2>Outreach job, recent</h2><pre>' + esc("\n".join(outreach_tail())) + '</pre></div>')
    H.append('</div></body></html>')

    os.makedirs(os.path.join(ROOT, "site/ops"), exist_ok=True)
    open(os.path.join(ROOT, "site/ops/index.html"), "w").write("\n".join(H))
    # the full board, addresses stripped, next to it
    a, b = track.html(reqs)
    board = open(a).read()
    board = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+", "[address]", board).replace('href="../../data/outreach/replies/', 'data-thread="')
    open(os.path.join(ROOT, "site/ops/board.html"), "w").write(board)
    print("wrote site/ops/index.html and site/ops/board.html")


if __name__ == "__main__":
    main()
