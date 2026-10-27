"""The ledger: every move made against a district and every outcome observed, one line each.

  data/game/moves.jsonl     {id, district_id, nces_id, state, name, kind, experiment, variant, channel, sent_at, request_id, to, by}
  data/game/outcomes.jsonl  {id, district_id, nces_id, state, name, kind, at, request_id, detail, source}

  python3 tools/game/ledger.py --backfill    rebuild both from data/outreach/requests.json, data/victories.jsonl,
                                             data/corrections.jsonl and data/outreach/clicks.json; lines recorded live
                                             by the pipeline are kept (merge by id)
  python3 tools/game/ledger.py               counts

From the pipeline:  import ledger; ledger.record_move(request, variant=..., experiment=...); ledger.record_outcome(...)

Move kinds (what we did): ask_policy, records_request, records_request_handbook, records_request_minutes,
records_request_research, ask_handbook_dated, align_policy, certificate, certificate_state, state_doe_request,
followup, reply. Outcome kinds (what happened): reply, document, status_recorded, certificate, policy_flip,
record_correction, click, board_agenda. Ids are hashes of the identifying fields, so a backfill never duplicates
a line the pipeline already wrote."""
import os, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (GAME, VICTORIES, CORRECTIONS, ROOT, load_requests, read_jsonl, append_jsonl, write_jsonl, district_id, parse_dt, short_hash, now_iso)

MOVES = os.path.join(GAME, "moves.jsonl"); OUTCOMES = os.path.join(GAME, "outcomes.jsonl")
FRIENDLY_ASK_SINCE = "2026-10-09"   # before this the first ask was the formal records request (git f5511faa)
MOVE_KIND = {"policy": "ask_policy", "nothing on file": "records_request", "handbook silent": "records_request_handbook", "minutes": "records_request_minutes",
             "research": "records_request_research", "handbook_dated": "ask_handbook_dated", "align": "align_policy", "certificate": "certificate",
             "certificate_state": "certificate_state", "state_doe": "state_doe_request"}
EXPERIMENT_OF = {"ask_policy": "ask_policy", "align_policy": "align_policy"}
DOCUMENT_REPLIES = {"document_linked", "document_attached", "document"}

def _who(r):
    return {"district_id": district_id(r), "nces_id": r.get("nces_id") or None, "state": r.get("state"), "name": r.get("name")}

def move_row(r, kind, sent_at, variant=None, experiment=None, channel="email", to=None, by="pipeline", request_id=None, extra=None):
    row = {**_who(r), "kind": kind, "experiment": experiment, "variant": variant, "channel": channel, "sent_at": sent_at,
           "request_id": request_id if request_id is not None else r.get("id"), "to": to or r.get("to"), "by": by}
    if extra: row.update(extra)
    row["id"] = short_hash(row["district_id"], kind, sent_at, row["request_id"])
    return row

def outcome_row(r, kind, at, detail=None, source=None, request_id=None):
    row = {**_who(r), "kind": kind, "at": at, "request_id": request_id if request_id is not None else r.get("id"), "detail": detail, "source": source}
    row["id"] = short_hash(row["district_id"], kind, at, json.dumps(detail, sort_keys=True) if isinstance(detail, dict) else detail)
    return row

def _existing_ids(path):
    return {x.get("id") for x in read_jsonl(path)}

def record_move(r, kind=None, variant=None, experiment=None, channel="email", sent_at=None, to=None, by="pipeline", extra=None):
    """Append one move. `r` is an outreach request (or any dict with state, name, nces_id, id, to). Returns the row,
    or None when that exact move is already on file."""
    kind = kind or MOVE_KIND.get(r.get("kind"), r.get("kind") or "other")
    sent_at = sent_at or r.get("sent_at") or now_iso()
    variant = variant if variant is not None else r.get("variant")
    experiment = experiment if experiment is not None else (r.get("experiment") or EXPERIMENT_OF.get(kind))
    row = move_row(r, kind, sent_at, variant=variant, experiment=experiment, channel=channel, to=to, by=by, extra=extra)
    if row["id"] in _existing_ids(MOVES): return None
    append_jsonl(MOVES, [row]); return row

def record_outcome(r, kind, at=None, detail=None, source=None, request_id=None):
    """Append one outcome: reply, document, status_recorded, certificate, policy_flip, record_correction, click, board_agenda."""
    row = outcome_row(r, kind, at or now_iso(), detail=detail, source=source, request_id=request_id)
    if row["id"] in _existing_ids(OUTCOMES): return None
    append_jsonl(OUTCOMES, [row]); return row

# ---------------------------------------------------------------- backfill
def _iso(dt): return dt.isoformat(timespec="seconds") if dt else None

def from_requests(reqs):
    moves, outs = [], []
    for r in reqs:
        kind = MOVE_KIND.get(r.get("kind"), r.get("kind") or "other")
        sent = _iso(parse_dt(r.get("sent_at")))
        if sent:
            variant = experiment = None
            if kind == "ask_policy": experiment, variant = "ask_policy", ("A" if sent >= FRIENDLY_ASK_SINCE else "legacy")
            if kind == "align_policy": experiment, variant = "align_policy", "A"
            if r.get("variant"): variant = r["variant"]; experiment = r.get("experiment") or experiment
            moves.append(move_row(r, kind, sent, variant=variant, experiment=experiment, by="pipeline",
                                  extra={"attachment": bool(r.get("attachments"))} if kind in ("align_policy", "certificate") else None))
            if kind in ("certificate",): outs.append(outcome_row(r, "certificate", sent, detail=r.get("notes"), source=r.get("certificate_pdf")))
        fu = _iso(parse_dt(r.get("followup_sent_at")))
        if fu: moves.append(move_row(r, "followup", fu, by="pipeline"))
        for m in r.get("our_messages") or []:
            at = _iso(parse_dt(m.get("at")))
            if at: moves.append(move_row(r, "reply", at, to=m.get("to"), by=m.get("by") or "writer"))
        for x in r.get("replies") or []:
            at = _iso(parse_dt(x.get("date"))) or _iso(parse_dt(r.get("last_reply_at")))
            if not at: continue
            outs.append(outcome_row(r, "reply", at, detail=x.get("kind"), source=x.get("file")))
            if x.get("kind") in DOCUMENT_REPLIES: outs.append(outcome_row(r, "document", at, detail=x.get("kind"), source=(x.get("links") or [None])[0]))
        if r.get("recorded_status"):
            at = _iso(parse_dt(r.get("rechecked_at")) or parse_dt(r.get("last_reply_at")) or parse_dt(r.get("sent_at")))
            outs.append(outcome_row(r, "status_recorded", at, detail=r["recorded_status"]))
    return moves, outs

def from_flips():
    outs = []
    for v in read_jsonl(VICTORIES):
        outs.append(outcome_row(v, "policy_flip", _iso(parse_dt(v.get("at"))), detail={"from": v.get("from"), "to": v.get("to")}, source=v.get("source"), request_id=None))
    for c in read_jsonl(CORRECTIONS):
        if not c.get("to"): continue
        outs.append(outcome_row(c, "record_correction", _iso(parse_dt(c.get("at"))), detail={"from": c.get("from"), "to": c.get("to"), "retracted": c.get("retracted")}, source=c.get("source"), request_id=None))
    return outs

def from_clicks():
    p = os.path.join(ROOT, "data/outreach/clicks.json")
    if not os.path.exists(p): return []
    outs = []
    for c in json.load(open(p)):
        if not c.get("nces_id") or c["nces_id"] == "0000000" or c.get("campaign") == "test": continue
        outs.append(outcome_row(c, "click", _iso(parse_dt(c.get("first"))), detail={"campaign": c.get("campaign"), "visits": c.get("visits")}, source=c.get("token"), request_id=None))
    return outs

def backfill():
    reqs = load_requests()
    moves, outs = from_requests(reqs); outs += from_flips() + from_clicks()
    def merge(path, fresh):
        by = {x["id"]: x for x in read_jsonl(path)}   # keep what the pipeline wrote live; a backfilled row with the same id is the same event
        for x in fresh: by.setdefault(x["id"], x)
        rows = sorted(by.values(), key=lambda x: (x.get("sent_at") or x.get("at") or "", x["id"]))
        write_jsonl(path, rows); return rows
    m, o = merge(MOVES, moves), merge(OUTCOMES, outs)
    print(f"backfill: {len(m)} moves, {len(o)} outcomes")
    print("  moves:", dict(collections.Counter(x["kind"] for x in m)))
    print("  variants:", dict(collections.Counter((x["experiment"], x["variant"]) for x in m if x.get("experiment"))))
    print("  outcomes:", dict(collections.Counter(x["kind"] for x in o)))

if __name__ == "__main__":
    if "--backfill" in sys.argv: backfill()
    else:
        m, o = read_jsonl(MOVES), read_jsonl(OUTCOMES)
        print(f"{len(m)} moves, {len(o)} outcomes; kinds:", dict(collections.Counter(x['kind'] for x in m)), dict(collections.Counter(x['kind'] for x in o)))
