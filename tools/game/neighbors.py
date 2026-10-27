"""Neighbor targeting. For every district that moved to a ban, the permitting districts in the same county and the
adjacent counties, ranked by enrollment: the next asks, with a neighbor to point to.

  python3 tools/game/neighbors.py            write data/game/next-targets.json and print the top ten
  python3 tools/game/neighbors.py --anchors  list the anchors (districts that moved) and why each counts

Anchors, strongest first:
  policy_flip         data/victories.jsonl: the district's own rule went from permitting to prohibiting
  record_correction   data/corrections.jsonl: the record was corrected to bans from a permitting value (retractions skipped)
  recorded_ban        the district wrote back and the record now says bans (recorded_status in requests.json)
  certified           the district holds a Safe School certificate (a ban on the books, recognized)
Counties come from data/nces/lea-geocode-2023-24.csv (the district office) or the record's county name; adjacency from
data/geo/county-adjacency.csv. A target is a district whose status is allows or consent_required in a state whose law
permits the practice."""
import os, sys, csv, json, re, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (GAME, ROOT, VICTORIES, CORRECTIONS, load_districts, load_states, load_requests, load_policy_lag, read_jsonl, write_json,
                    district_id, now_iso, PERMITTING)
from ledger import MOVES

ADJ = os.path.join(ROOT, "data/geo/county-adjacency.csv"); OUT = os.path.join(GAME, "next-targets.json")
BASIS_RANK = {"policy_flip": 0, "record_correction": 1, "recorded_ban": 2, "certified": 3}

def _norm(name, st):
    n = re.sub(r"\s+(county|parish|borough|census area|municipality|city and borough|city)$", "", str(name or "").strip().lower())
    return f"{n}|{st}"

def adjacency():
    """fips -> set of neighbor fips, and normalized 'name|ST' -> fips for districts with a county name but no geocode."""
    adj, names = collections.defaultdict(set), {}
    if not os.path.exists(ADJ): return adj, names
    for r in csv.DictReader(open(ADJ)):
        adj[r["fips"]].add(r["neighbor_fips"])
        for f, n in ((r["fips"], r["county"]), (r["neighbor_fips"], r["neighbor"])):
            if "," in n:
                nm, st = n.rsplit(",", 1); names.setdefault(_norm(nm, st.strip()), f)
    return adj, names

def anchors():
    """Districts that moved to a ban, deduped, strongest basis kept."""
    ds = {d["id"]: d for d in load_districts()}; out = {}
    def add(x, basis, at, note=None):
        did = district_id(x); d = ds.get(did)
        if not d or d["status"] != "bans" and basis != "policy_flip": return
        cur = out.get(did)
        if cur and BASIS_RANK[cur["basis"]] <= BASIS_RANK[basis]: return
        out[did] = {"district_id": did, "state": d["state"] if d else x.get("state"), "name": d["name"] if d else x.get("name"), "basis": basis, "at": at,
                    "county": d["county"] if d else None, "county_fips": d["county_fips"] if d else None, "enrollment": d["enrollment"] if d else None,
                    "quote": (d or {}).get("quote"), "source": (d or {}).get("source"), "note": note}
    for v in read_jsonl(VICTORIES): add(v, "policy_flip", v.get("at"))
    for c in read_jsonl(CORRECTIONS):
        if c.get("to") == "bans" and not c.get("retracted"): add(c, "record_correction", c.get("at"), f"was {c.get('from')}")
    for r in load_requests():
        if r.get("recorded_status") == "bans": add(r, "recorded_ban", r.get("rechecked_at") or r.get("last_reply_at") or r.get("sent_at"))
        if r.get("kind") == "certificate" and r.get("sent_at"): add(r, "certified", r.get("sent_at"), r.get("notes"))
    return sorted(out.values(), key=lambda a: (BASIS_RANK[a["basis"]], -(a["enrollment"] or 0)))

def compute():
    adj, names = adjacency(); laws = load_states(); ds = load_districts()
    lag = {str(d.get("nces_id")) for d in load_policy_lag()}
    last_move = {}
    for m in read_jsonl(MOVES):
        if m.get("sent_at") and (m["district_id"] not in last_move or m["sent_at"] > last_move[m["district_id"]]["sent_at"]): last_move[m["district_id"]] = m
    def fips_of(d): return d.get("county_fips") or names.get(_norm(d.get("county"), d.get("state")))
    by_fips = collections.defaultdict(list)
    for d in ds:
        if d["status"] in PERMITTING and (laws.get(d["state"]) or {}).get("status") != "banned":
            f = fips_of(d)
            if f: by_fips[f].append(d)
    per_anchor, agg = [], {}
    for a in anchors():
        f = fips_of(a)
        if not f: per_anchor.append({**a, "county_fips": None, "targets": [], "why_empty": "no county on file"}); continue
        a["county_fips"] = f; ts = []
        for cf in [f] + sorted(adj.get(f, ())):
            for d in by_fips.get(cf, []):
                if d["id"] == a["district_id"]: continue
                lm = last_move.get(d["id"])
                t = {"district_id": d["id"], "state": d["state"], "name": d["name"], "county": d["county"], "county_fips": cf, "same_county": cf == f, "status": d["status"],
                     "enrollment": d["enrollment"], "band": d["band"], "policy_lag": d["nces_id"] in lag, "crdc_students": d["crdc_students"],
                     "last_move": {"kind": lm["kind"], "sent_at": lm["sent_at"], "variant": lm.get("variant")} if lm else None, "contact_email": (d["contact"] or {}).get("district_email") or (d["contact"] or {}).get("board_email")}
                ts.append(t)
                g = agg.setdefault(d["id"], {**{k: v for k, v in t.items() if k != "same_county"}, "anchors": []})
                g["anchors"].append({"district_id": a["district_id"], "name": a["name"], "basis": a["basis"], "same_county": cf == f})
        ts.sort(key=lambda t: (-(t["enrollment"] or 0), not t["same_county"]))
        per_anchor.append({**a, "targets": ts[:25], "target_count": len(ts)})
    ranked = sorted(agg.values(), key=lambda g: (-(g["enrollment"] or 0), -len(g["anchors"])))
    for g in ranked: g["anchors"].sort(key=lambda x: (BASIS_RANK[x["basis"]], not x["same_county"]))
    return {"as_of": now_iso(), "how": "permitting districts in the same or an adjacent county as a district that moved to a ban, ranked by enrollment",
            "anchor_count": len(per_anchor), "target_count": len(ranked), "ranked": ranked[:300], "by_anchor": per_anchor}

def main():
    if "--anchors" in sys.argv:
        for a in anchors(): print(f"{a['basis']:18} {a['state']} {a['name'][:40]:40} {a['county'] or '?':18} {a['enrollment'] or 0:>7,}  {str(a['at'])[:10]}")
        return
    res = compute(); write_json(OUT, res)
    print(f"next-targets: {res['anchor_count']} anchors, {res['target_count']} permitting neighbors")
    print(f"{'state':5} {'district':40} {'county':16} {'enroll':>7} {'status':16} lag  last move            next to")
    for g in res["ranked"][:10]:
        a = g["anchors"][0]; lm = g["last_move"]
        print(f"{g['state']:5} {g['name'][:40]:40} {(g['county'] or '?')[:16]:16} {g['enrollment'] or 0:>7,} {g['status']:16} {'yes' if g['policy_lag'] else 'no ':3}  {(lm['kind'] + ' ' + lm['sent_at'][:10]) if lm else '-':20} {a['name'][:28]} ({a['basis']})")
    return res

if __name__ == "__main__":
    main()
