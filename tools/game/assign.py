"""Which variant a district gets, and how that variant renders.

  python3 tools/game/assign.py                      build or refresh data/game/assignments.json for every live experiment
  python3 tools/game/assign.py ask_policy 4818180   show one district's variant

assign(experiment, district) is deterministic: within each (state, enrollment band) stratum the districts in the record
are ordered by sha1(district_id|experiment) and dealt round-robin over the variants, so every stratum is balanced to
within one district. The table is frozen in data/game/assignments.json the first time it is built; a district that
appears later (not in the record, or added to it) is dealt by hash parity and appended, so nothing ever moves.

From the pipeline: apply(request) sets request["experiment"], request["variant"], drops the attachment when the variant
says `attachment: none`, and sets status `held` when the variant is not yet approved. subject(request) and
body(request) return the rendered copy for a templated variant, or None so run.py keeps today's code path."""
import os, sys, json, hashlib, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import GAME, ROOT, load_districts, district_id, band, enrollment_map, write_json

EXPERIMENTS = os.path.join(GAME, "experiments.yaml"); ASSIGNMENTS = os.path.join(GAME, "assignments.json")
_EXP = None; _TABLE = None

def experiments():
    global _EXP
    if _EXP is None:
        import yaml
        _EXP = (yaml.safe_load(open(EXPERIMENTS)) or {}).get("experiments") or {}
    return _EXP

def experiment_for_kind(kind):
    """The live experiment whose request kind matches, as (id, spec), or (None, None)."""
    for k, e in experiments().items():
        if e.get("kind") == kind and e.get("status", "live") == "live": return k, e
    return None, None

def variant_ids(exp): return list((exp.get("variants") or {}).keys())

def _h(did, exp_id): return hashlib.sha1(f"{did}|{exp_id}".encode()).hexdigest()

def _table():
    global _TABLE
    if _TABLE is None:
        _TABLE = json.load(open(ASSIGNMENTS)) if os.path.exists(ASSIGNMENTS) else {}
    return _TABLE

def build(exp_id, save=True):
    """Deal every district in the record for one experiment, stratified; keep any assignment already frozen."""
    exp = experiments()[exp_id]; vids = variant_ids(exp)
    tab = _table().setdefault(exp_id, {})
    strata = collections.defaultdict(list)
    for d in load_districts(): strata[(d["state"], d["band"])].append(d["id"])
    for key, ids in strata.items():
        fresh = sorted((i for i in ids if i not in tab), key=lambda i: _h(i, exp_id))
        # continue the round-robin from where the stratum already stands, so a rebuild stays balanced
        offset = len([i for i in ids if i in tab])
        for n, i in enumerate(fresh): tab[i] = vids[(offset + n) % len(vids)]
    if save: write_json(ASSIGNMENTS, _table())
    return tab

def assign(exp_id, d):
    """Variant id for a district (a record dict or an outreach request). Frozen once given."""
    exp = experiments().get(exp_id)
    if not exp: return None
    vids = variant_ids(exp)
    if not vids: return None
    did = district_id(d)
    tab = _table().get(exp_id)
    if tab is None: tab = build(exp_id)
    if did not in tab:
        tab[did] = vids[int(_h(did, exp_id), 16) % len(vids)]; write_json(ASSIGNMENTS, _table())
    return tab[did]

def spec(exp_id, vid):
    return ((experiments().get(exp_id) or {}).get("variants") or {}).get(vid) or {}

def approved(exp_id, vid): return bool(spec(exp_id, vid).get("approved"))

def apply(r):
    """Called by run.py when a request is queued: choose the variant, record it on the request, hold it if unapproved."""
    exp_id, exp = experiment_for_kind(r.get("kind"))
    if not exp_id: return r
    vid = assign(exp_id, r); r["experiment"] = exp_id; r["variant"] = vid
    s = spec(exp_id, vid)
    if str(s.get("attachment", "")).lower() in ("none", "no", "link") and r.get("attachments"): r["attachments"] = []
    if not approved(exp_id, vid) and r.get("status") == "pending": r["status"] = "held"; r["held_why"] = f"variant {vid} of {exp_id} awaits approval"
    return r

def _fields(r):
    sys.path.insert(0, os.path.join(ROOT, "tools/outreach"))
    import messages
    who = messages.addressed_name(r) if r.get("kind") == "align" else messages.first_name(r.get("superintendent"))
    return {"who": who, "district": messages.nice(r["name"]), "sig": messages.sig(None), "state": r.get("state"),
            "quote": messages.tidy_quote(r.get("quote")), "code": r.get("policy_code") or ""}

def subject(r):
    s = spec(r.get("experiment"), r.get("variant")) if r.get("experiment") else {}
    if not s.get("body"): return None            # variant A: today's code renders it
    return s["subject"].format(**_fields(r)) if s.get("subject") else None

def body(r):
    s = spec(r.get("experiment"), r.get("variant")) if r.get("experiment") else {}
    if not s.get("body"): return None
    return s["body"].format(**_fields(r))

if __name__ == "__main__":
    if len(sys.argv) >= 3:
        e, did = sys.argv[1], sys.argv[2]
        ds = {d["id"]: d for d in load_districts()}; d = ds.get(did) or {"nces_id": did, "state": "", "name": did}
        print(e, did, d.get("name"), d.get("state"), d.get("band"), "->", assign(e, d), "approved" if approved(e, assign(e, d)) else "NOT approved (held)")
    else:
        for e in experiments():
            tab = build(e); c = collections.Counter(tab.values())
            print(f"{e}: {len(tab)} districts dealt, {dict(c)}")
            ds = {d["id"]: d for d in load_districts()}
            per = collections.defaultdict(collections.Counter)
            for i, v in tab.items():
                if i in ds: per[ds[i]["state"]][v] += 1
            print("   ", " ".join(f"{st}:{'/'.join(str(per[st][v]) for v in sorted(per[st]))}" for st in sorted(per)))
