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

    by = sorted(rec["by"].items(), key=lambda kv: -(kv[1]["allows"] + kv[1]["consent"] + (kv[1]["total"] - kv[1]["quoted"])))
    hit = rec["status"].get("allows", 0) + rec["status"].get("consent_required", 0)
    banned = rec["status"].get("bans", 0)
    unknown = rec["total"] - rec["quoted"]
    needs_you = len(rows.get("needs_you") or [])
    dreqs = [r for r in reqs if r.get("kind") != "state_doe" and r.get("sent_at")]
    replied = sum(1 for r in dreqs if any(e.get("from") != "us" and e.get("kind") != "auto_reply_or_bounce" for e in r.get("replies") or []))
    districts_asked = len(dreqs)
    agencies_asked = len({r["state"] for r in agencies}) + len({f["state"] for f in forms if f.get("submitted_at")} - {r["state"] for r in agencies})
    H = []
    H.append(f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Safe Schools Project · status</title><meta name="robots" content="noindex">
<meta property="og:title" content="Safe Schools Project · status"><meta property="og:description" content="How many school districts still let adults hit children, how many have stopped, and what we did today."><meta property="og:type" content="website"><meta property="og:url" content="https://earthpilot.org/kids/ops/"><meta property="og:site_name" content="End School Corporal Punishment"><meta property="og:image" content="https://earthpilot.org/kids/assets/og.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Safe Schools Project · status"><meta name="twitter:description" content="How many school districts still let adults hit children, how many have stopped, and what we did today."><meta name="twitter:image" content="https://earthpilot.org/kids/assets/og.png">
<meta http-equiv="refresh" content="300">
<style>
:root{{--bg:#0B0F1E;--panel:#121832;--line:#232B4A;--ink:#E8ECF1;--mute:#8B95A5;--dim:#5E6A8A;--gold:#FDE68A;--green:#43E08A;--red:#FF6B6B;--amber:#FFB000;--blue:#7DD3FC}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 'Source Sans 3',system-ui,sans-serif;padding:24px 16px 60px;max-width:960px;margin:0 auto}}
h1{{font-size:26px;margin:0 0 .2rem;font-weight:600}}h2{{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);margin:0 0 .7rem;font-weight:600}}
.meta{{color:var(--dim);margin:0 0 1.4rem;font-size:14px}}.panel{{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:14px}}
.big{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}}.big b{{display:block;font-size:40px;font-weight:700;line-height:1.05}}.big span{{color:var(--mute);font-size:14px}}
.ok{{border-color:#1f4d35}}.ok b{{color:var(--green)}}.bad{{border-color:#5a2222}}
table{{border-collapse:collapse;width:100%;font-size:15px}}td,th{{padding:.3rem .5rem;border-bottom:1px solid var(--line);text-align:left;font-weight:400}}th{{color:var(--mute);font-size:12px;letter-spacing:.06em;text-transform:uppercase}}td.n{{text-align:right;font-variant-numeric:tabular-nums}}
.g{{color:var(--green)}}.r{{color:var(--red)}}.a{{color:var(--amber)}}.m{{color:var(--mute)}}
details{{margin-top:10px}}summary{{cursor:pointer;color:var(--mute)}}pre{{white-space:pre-wrap;word-break:break-word;color:var(--mute);font:12px/1.4 ui-monospace,Menlo,monospace;max-height:360px;overflow:auto;margin:.5rem 0 0}}
a{{color:var(--blue);text-decoration:none}}a:hover{{text-decoration:underline}}p{{margin:.5rem 0 0}}
</style></head><body>
<h1>Safe Schools Project</h1><p class="meta">Status as of {esc(now.strftime('%A %B %-d, %-I:%M %p'))}. Updates itself every few minutes. <a href="/kids/ops/crm.html">CRM</a> · <a href="/kids/ops/decisions.html">Decisions</a> · <a href="/kids/live/">Watch it live</a> · <a href="/kids/">The public record</a></p>""")

    # 1. The one question
    H.append(f"""<div class="panel"><h2>Where we stand</h2><div class="big">
<div><b class="r">{hit:,}</b><span>districts still allow adults to hit children</span></div>
<div><b class="g">{banned:,}</b><span>districts have banned it</span></div>
<div><b class="a">{unknown:,}</b><span>districts we haven't got an answer from yet</span></div></div>
<p class="m">We count a district only when we have its own written rule, word for word, with a link to the document. {rec['status'].get('consent_required',0):,} of the "still allow" districts require a parent's permission first.</p></div>""")

    # 2. Does anything need Anthony
    if needs_you:
        H.append(f"""<div class="panel bad"><h2>Needs you</h2><div class="big"><div><b class="r">{needs_you}</b><span>email threads waiting for your call</span></div></div><p class="m">Each one is a draft in Gmail with the suggested reply inside. <a href="/kids/ops/board.html">See which</a>.</p></div>""")
    else:
        H.append("""<div class="panel ok"><h2>Needs you</h2><div class="big"><div><b>0</b><span>nothing is waiting on you</span></div></div></div>""")

    # 3. Today
    H.append(f"""<div class="panel"><h2>Today</h2><div class="big">
<div><b>{sum(v['today'] for _, v in by):,}</b><span>district rules found</span></div>
<div><b>{sent_today}</b><span>emails sent to districts</span></div>
<div><b>{replies_today}</b><span>replies that came in</span></div>
<div><b>{pending}</b><span>emails lined up to go</span></div></div></div>""")

    # 4. Who we've asked
    waiting = districts_asked - replied
    H.append(f"""<div class="panel"><h2>Who we've asked</h2><div class="big">
<div><b>{districts_asked:,}</b><span>districts emailed</span></div>
<div><b>{replied:,}</b><span>wrote back</span></div>
<div><b>{waiting:,}</b><span>haven't answered yet</span></div>
<div><b>{agencies_asked}</b><span>state education departments asked for everything they hold</span></div></div>
<p class="m">Emails are answered automatically within 15 minutes. If a district refuses, it gets a formal public-records request. {len(rows.get('residency') or [])} districts will only answer a resident of their state. <a href="/kids/ops/board.html">Every conversation</a>.</p></div>""")

    # 5. By state, simplified
    H.append('<div class="panel"><h2>By state</h2><table><tr><th>State</th><th class="n">Still allow it</th><th class="n">Banned it</th><th class="n">No answer yet</th><th class="n">Found today</th></tr>')
    for st, v in by:
        if v["total"] == 0: continue
        H.append(f'<tr><td><a href="/kids/state/{esc(st)}/">{esc(st)}</a></td><td class="n r">{v["allows"]+v["consent"] or ""}</td><td class="n g">{v["bans"] or ""}</td><td class="n a">{(v["total"]-v["quoted"]) or ""}</td><td class="n">{v["today"] or ""}</td></tr>')
    H.append('</table></div>')

    # 6. Everything else, folded away
    H.append('<div class="panel"><h2>Under the hood</h2>')
    H.append('<details><summary>State education departments</summary><table><tr><th>State</th><th>How</th><th>Sent</th><th>Where it stands</th></tr>')
    seen = set()
    for r in sorted(agencies, key=lambda x: x["state"]):
        seen.add(r["state"]); st, why = track.stage(r)
        H.append(f'<tr><td>{esc(r["state"])}</td><td class="m">email</td><td class="m">{esc((r.get("sent_at") or "")[:10])}</td><td>{esc(r.get("status"))}{(" · answer due " + esc(r.get("promised_by"))) if r.get("promised_by") else ""} <span class="m">{esc(why)}</span></td></tr>')
    for f in forms:
        if f["state"] in seen or not f.get("submitted_at"): continue
        H.append(f'<tr><td>{esc(f["state"])}</td><td class="m">web form</td><td class="m">{esc(f["submitted_at"][:10])}</td><td>submitted</td></tr>')
    H.append('</table></details>')
    H.append('<details><summary>Automatic readers of state policy websites (run every night)</summary><table><tr><th>State</th><th>Reader</th><th class="n">Districts read</th><th>Last new finds</th></tr>')
    for p in portals():
        ln = f'{p["last_new"][0]} · {p["last_new"][1]}' if p["last_new"] else "nothing new since the first pass"
        H.append(f'<tr><td>{esc(p["state"])}</td><td class="m">{esc(p["harvester"])}</td><td class="n">{p["rows"]}</td><td class="m">{esc(ln)}</td></tr>')
    H.append('</table></details>')
    H.append('<details><summary>Last night\'s run</summary><pre>' + esc("\n".join(nightly_tail())) + '</pre></details>')
    H.append('<details><summary>Email job, recent activity</summary><pre>' + esc("\n".join(outreach_tail())) + '</pre></details>')
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
