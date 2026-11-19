"""Who clicked. Pulls cache/hits.jsonl from the site, joins it to data/outreach/links.jsonl, and prints visits by
district and person; also writes data/outreach/clicks.json for the ops page and the retargeting list, and
data/outreach/film-views.json: per film play, how far it got, so the report shows where viewers stop.

  python3 clicks.py            # fetch + report
  python3 clicks.py --local    # report from the last fetched copy"""
import json, os, subprocess, sys, collections, datetime
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
HITS = os.path.join(ROOT, "data/outreach/hits.jsonl")
LINKS = os.path.join(ROOT, "data/outreach/links.jsonl")

def env():
    d = {}
    for l in open(os.path.expanduser("~/.escp-deploy.env")):
        if "=" in l and not l.startswith("#"): k, v = l.strip().split("=", 1); d[k] = v.strip().strip('"')
    return d

def fetch():
    # The server's log is fetched beside the local copy and merged in, never copied over it: if the
    # server file is ever rotated, emptied or lost, the visits already pulled stay on this side.
    e = env(); tmp = HITS + ".fetch"
    cmd = ["sshpass", "-p", e["DEPLOY_PASS"], "rsync", "-az", "-e", "ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no",
           f"{e['DEPLOY_HOST']}:{e['DEPLOY_PATH']}cache/hits.jsonl", tmp]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print("fetch failed:", r.stderr.strip()[:200]); return
    have = [l for l in open(HITS).read().splitlines() if l.strip()] if os.path.exists(HITS) else []
    seen = set(have)
    fresh = [l for l in open(tmp).read().splitlines() if l.strip() and l not in seen]
    if fresh:
        with open(HITS + ".tmp", "w") as f: f.write("\n".join(have + fresh) + "\n")
        os.replace(HITS + ".tmp", HITS)
    os.remove(tmp)

if __name__ == "__main__":
    if "--local" not in sys.argv: fetch()
    links = {json.loads(l)["token"]: json.loads(l) for l in open(LINKS)} if os.path.exists(LINKS) else {}
    hits = [json.loads(l) for l in open(HITS)] if os.path.exists(HITS) else []
    by = collections.defaultdict(list)
    for h in hits:
        if h.get("r"): by[h["r"]].append(h)
    out = []
    for tok, hs in by.items():
        l = links.get(tok, {}); bots = sum(1 for h in hs if "bot" in h.get("ua", "").lower() or "preview" in h.get("ua", "").lower())
        out.append({"token": tok, "nces_id": l.get("nces_id"), "name": l.get("name"), "email": l.get("email"), "campaign": l.get("campaign"),
                    "visits": len(hs) - bots, "first": min(h["t"] for h in hs), "last": max(h["t"] for h in hs), "ips": sorted({h.get("ip") for h in hs})})
    out.sort(key=lambda x: x["last"], reverse=True)
    json.dump(out, open(os.path.join(ROOT, "data/outreach/clicks.json"), "w"), indent=1)
    print(f"{len(hits)} hits, {len(out)} tagged visitors, {sum(1 for h in hits if not h.get('r'))} untagged page views")
    for o in out[:40]: print(f"  {o['last'][:16]}  {o.get('campaign') or '?':<10} {str(o.get('nces_id') or ''):<8} {str(o.get('name') or '')[:26]:<26} {o['visits']} visit(s)")
    # Films: one row per page load (k), keeping the furthest second reached and seconds played; then where they stop
    loads = {}
    for h in hits:
        if not h.get("e") or "bot" in h.get("ua", "").lower(): continue
        x = loads.setdefault(h["k"], {"r": h.get("r"), "v": h.get("v"), "p": h.get("p"), "t": h["t"], "s": 0, "w": 0, "d": 0, "end": False})
        x["s"] = max(x["s"], h.get("s", 0)); x["w"] = max(x["w"], h.get("w", 0)); x["d"] = max(x["d"], h.get("d", 0)); x["end"] |= h["e"] == "end"
    if loads:
        rows = sorted(loads.values(), key=lambda x: x["t"], reverse=True)
        json.dump(rows, open(os.path.join(ROOT, "data/outreach/film-views.json"), "w"), indent=1)
        print(f"\nFilm plays: {len(rows)} ({sum(1 for x in rows if x['r'])} from tagged links)")
        for v in sorted({x["v"] for x in rows}):
            vr = [x for x in rows if x["v"] == v]; d = max(x["d"] for x in vr) or 1
            stops = collections.Counter(min(9, int(10 * (d if x["end"] else x["s"]) / d)) for x in vr)
            print(f"  {v}: {len(vr)} plays, {sum(1 for x in vr if x['end'])} to the end; still watching at each tenth:",
                  " ".join(f"{10*i}%:{sum(n for j, n in stops.items() if j >= i)}" for i in range(10)))
        for x in rows[:20]:
            l = links.get(x["r"] or "", {})
            print(f"  {x['t'][:16]}  {str(l.get('name') or ('untagged' if not x['r'] else x['r']))[:30]:<30} {x['s']}s of {x['d']}s reached, {x['w']}s played{' (finished)' if x['end'] else ''}")
