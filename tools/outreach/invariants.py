"""The rules the outreach system must never break, checked against the ledger every cycle and shown on the
ops page. Each came from a real failure on 2026-10-27: a certificate on a superintendent's email, a nudge to
a district that had already answered, two replies forty seconds apart, a certificate twenty-two minutes
after we had asked for a link. `check(reqs)` returns [(rule, count, examples)], examples newest first.

    python3 tools/outreach/invariants.py          # print the report
"""
import datetime, email.utils, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIRST_PERSON = re.compile(r"\b(we|our|us|I|I'm|I've|my|me|Anthony|Mr\.? Adams)\b")
WINDOW_DAYS = 7


def ts(d):
    try:
        return email.utils.parsedate_to_datetime(d).timestamp() if d and "," in str(d) else datetime.datetime.fromisoformat(str(d)[:19]).timestamp()
    except Exception:
        return 0


def recent(t, days=WINDOW_DAYS):
    return t and (datetime.datetime.now().timestamp() - t) < days * 86400


def check(reqs):
    out = []
    by_nces = {}
    for r in reqs:
        if r.get("nces_id") and r.get("kind") not in ("certificate", "certificate_correction", "apology", "board_note"):
            by_nces.setdefault(str(r["nces_id"]), []).append(r)

    # 1. A bans record with no policy behind it (the published rule, mirrored from validate.mjs)
    bad = []
    try:
        import yaml
        for f in sorted(os.listdir(os.path.join(ROOT, "data/districts"))):
            if not f.endswith(".yaml"): continue
            for x in yaml.safe_load(open(os.path.join(ROOT, "data/districts", f)))["districts"]:
                if x.get("status") != "bans": continue
                emailed = "-email-" in str(x.get("source") or "")
                if not x.get("quote") or (emailed and (not x.get("policy_code") or FIRST_PERSON.search(x["quote"]))): bad.append(f"{f[:2]} {x['name']}")
    except Exception as ex:
        bad.append(f"check failed: {ex!r}"[:80])
    out.append(("bans records resting on an email or no quote", len(bad), bad[:6]))

    # 2. A certificate sent while the district's thread still had an ask of ours open, or within two hours of their reply
    hits = []
    for c in reqs:
        if c.get("kind") != "certificate" or not recent(ts(c.get("sent_at"))) or c.get("retracted_at"): continue
        t = ts(c.get("sent_at"))
        for r in by_nces.get(str(c.get("nces_id")), []):
            asks = [k for k in ("awaiting_link_since", "minutes_requested_at", "formal_requested_at", "residency_asked_at") if r.get(k) and ts(r[k]) <= t and r.get("status") != "answered"]
            soon = r.get("last_reply_at") and 0 <= t - ts(r["last_reply_at"]) < 2 * 3600
            if asks or soon: hits.append(f"{c['state']} {c['name']} ({'open ' + asks[0] if asks else 'reply under 2h'})")
    out.append(("certificates sent on open threads", len(hits), hits[:6]))

    # 3. A nudge after the district had already replied
    hits = []
    for r in reqs:
        n = r.get("followup_sent_at")
        if not n or n == "n/a" or not recent(ts(n)): continue
        if any(e.get("kind") != "auto_reply_or_bounce" and ts(e.get("date")) < ts(n) for e in r.get("replies") or []): hits.append(f"{r['state']} {r['name']}")
    out.append(("nudges sent after a reply", len(hits), hits[:6]))

    # 4. Two automatic replies to one thread within ten minutes
    hits = []
    for r in reqs:
        ours = sorted(ts(e.get("date")) for e in r.get("replies") or [] if e.get("our_reply") and e.get("move") != "fold")
        if any(0 < b - a < 600 and recent(b) for a, b in zip(ours, ours[1:])): hits.append(f"{r['state']} {r['name']}")
    out.append(("threads answered twice within ten minutes", len(hits), hits[:6]))

    # 5. One address written to twice in a day by messages that open a new topic
    hits = []; last = {}
    sends = sorted(((ts(r.get("sent_at")), (r.get("to") or "").lower(), r) for r in reqs if r.get("sent_at") and r.get("kind") not in ("apology", "certificate_correction")), key=lambda x: x[0])
    for t, to, r in sends:
        if not recent(t): continue
        if to in last and t - last[to] < 86400: hits.append(f"{r['state']} {r['name']} ({r.get('kind')})")
        last[to] = t
    out.append(("addresses written to twice in 24 hours", len(hits), hits[:6]))
    return out


def html(reqs):
    rows = check(reqs); bad = sum(1 for _, n, _ in rows if n)
    esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    h = [f'<div class="panel {"bad" if bad else "ok"}"><h2>Invariants, last {WINDOW_DAYS} days</h2><table>']
    for rule, n, ex in rows:
        h.append(f'<tr><td>{esc(rule)}</td><td class="n"><b class="{"r" if n else ""}">{n}</b></td><td class="m">{esc("; ".join(ex))}</td></tr>')
    h.append("</table></div>")
    return "\n".join(h)


if __name__ == "__main__":
    reqs = json.load(open(os.path.join(ROOT, "data/outreach/requests.json")))
    for rule, n, ex in check(reqs):
        print(f"{n:4d}  {rule}" + (f"   e.g. {'; '.join(ex[:3])}" if ex else ""))
