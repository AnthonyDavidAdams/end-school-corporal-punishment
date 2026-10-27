"""Who clicked. Pulls cache/hits.jsonl from the site, joins it to data/outreach/links.jsonl, and prints visits by
district and person; also writes data/outreach/clicks.json for the ops page and the retargeting list.

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
    e = env()
    cmd = ["sshpass", "-p", e["DEPLOY_PASS"], "rsync", "-az", "-e", "ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no",
           f"{e['DEPLOY_HOST']}:{e['DEPLOY_PATH']}cache/hits.jsonl", HITS]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print("fetch failed:", r.stderr.strip()[:200])

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
