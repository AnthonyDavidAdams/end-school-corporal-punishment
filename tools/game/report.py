"""What the experiments say so far. Per experiment and variant: moves sent, the reply rate at 7 days, and the
document-or-status-flip rate at 14 and 30 days, with counts, only over moves old enough to have had the chance.

  python3 tools/game/report.py          print the table and write data/game/report.md
  python3 tools/game/report.py --json   also print the numbers as JSON

A "reply" is any outcome of kind reply from the same district after the move. A "win" is an outcome of kind document,
status_recorded, policy_flip, record_correction (to bans) or certificate from the same district after the move."""
import os, sys, json, datetime, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import GAME, read_jsonl, parse_dt, now, today
from ledger import MOVES, OUTCOMES
from assign import experiments

REPORT = os.path.join(GAME, "report.md")
WIN_KINDS = {"document", "status_recorded", "policy_flip", "record_correction", "certificate"}

def _is_win(o):
    if o["kind"] == "record_correction":
        return (o.get("detail") or {}).get("to") == "bans" and not (o.get("detail") or {}).get("retracted")
    return o["kind"] in WIN_KINDS

def compute(at=None):
    at = at or now()
    moves, outs = read_jsonl(MOVES), read_jsonl(OUTCOMES)
    by_d = collections.defaultdict(list)
    for o in outs:
        t = parse_dt(o.get("at"))
        if t: by_d[o["district_id"]].append((t, o))
    def hit(did, start, days, pred):
        end = start + datetime.timedelta(days=days)
        return any(start < t <= end and pred(o) for t, o in by_d.get(did, []))
    res = {}
    for exp_id, exp in experiments().items():
        rows = {}
        for m in moves:
            if m.get("experiment") != exp_id: continue
            v = m.get("variant") or "?"; t = parse_dt(m.get("sent_at"))
            if not t: continue
            r = rows.setdefault(v, {"sent": 0, "mature7": 0, "replied7": 0, "mature14": 0, "won14": 0, "mature30": 0, "won30": 0, "first": None, "last": None})
            r["sent"] += 1; r["first"] = min(r["first"] or m["sent_at"], m["sent_at"]); r["last"] = max(r["last"] or m["sent_at"], m["sent_at"])
            for days, mk, hk, pred in ((7, "mature7", "replied7", lambda o: o["kind"] == "reply"), (14, "mature14", "won14", _is_win), (30, "mature30", "won30", _is_win)):
                if at - t >= datetime.timedelta(days=days):
                    r[mk] += 1
                    if hit(m["district_id"], t, days, pred): r[hk] += 1
        for v, r in rows.items():
            r["reply_rate_7d"] = round(r["replied7"] / r["mature7"], 3) if r["mature7"] else None
            r["win_rate_14d"] = round(r["won14"] / r["mature14"], 3) if r["mature14"] else None
            r["win_rate_30d"] = round(r["won30"] / r["mature30"], 3) if r["mature30"] else None
            s = (exp.get("variants") or {}).get(v) or {}
            r["name"] = s.get("name") or ("earlier copy" if v == "legacy" else v); r["approved"] = bool(s.get("approved")) if v in (exp.get("variants") or {}) else None
        res[exp_id] = {"question": exp.get("question"), "kind": exp.get("kind"), "variants": dict(sorted(rows.items()))}
    return res

def pct(x): return "n/a" if x is None else f"{x:.0%}"

def table(res):
    lines = []
    for exp_id, e in res.items():
        lines.append(f"### {exp_id}\n")
        if e.get("question"): lines.append(f"{e['question']}\n")
        lines.append("| variant | name | approved | sent | first | last | reply at 7d | win at 14d | win at 30d |")
        lines.append("|---|---|---|---:|---|---|---:|---:|---:|")
        if not e["variants"]: lines.append("| (no moves yet) | | | | | | | | |")
        for v, r in e["variants"].items():
            lines.append(f"| {v} | {r['name']} | {'yes' if r['approved'] else ('no' if r['approved'] is False else '')} | {r['sent']} | {(r['first'] or '')[:10]} | {(r['last'] or '')[:10]} | "
                         f"{pct(r['reply_rate_7d'])} ({r['replied7']}/{r['mature7']}) | {pct(r['win_rate_14d'])} ({r['won14']}/{r['mature14']}) | {pct(r['win_rate_30d'])} ({r['won30']}/{r['mature30']}) |")
        lines.append("")
    return "\n".join(lines)

def main():
    res = compute(); md = table(res)
    text = f"# Experiment report, {today()}\n\nRates are over moves old enough for the window (sent at least 7, 14 or 30 days ago). A win is a document received, a status recorded, a policy flip or a certificate for that district after the move. Counts are in parentheses.\n\n{md}"
    open(REPORT, "w").write(text); print(text)
    if "--json" in sys.argv: print(json.dumps(res, indent=1))
    return res

if __name__ == "__main__":
    main()
