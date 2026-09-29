"""The correspondence board: every conversation, what it is owed, and what to do next.

Twenty-eight replies arriving as twenty-eight text messages is how a good response rate turns into a
burden. This is the answer: one board, computed from the request file rather than maintained by hand,
that says for each district what we asked, what they said, what we are still owed, and what the next
move is. Nothing here sends anything.

    python3 tools/outreach/track.py            the board, grouped by what needs doing
    python3 tools/outreach/track.py digest     one paragraph, for a text or a morning read
    python3 tools/outreach/track.py html       out/outreach/board.html, and the public summary
    python3 tools/outreach/track.py <state>    one state
"""
import datetime, json, os, re, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REQ = os.path.join(ROOT, "data/outreach/requests.json")

# What a thread is waiting on, in the order we want to see it. The first rule that matches wins, so the
# things a person has to decide come above the things the machine will do by itself tonight.
STAGES = [
    ("needs_you", "Needs you"),
    ("research", "Research requests — what the board relied on"),
    ("agency", "State agency requests"),
    ("residency", "Blocked on residency — send a proxy"),
    ("recheck", "Says it's on the site — re-check, then ask for the link"),
    ("escalate", "Claim with nothing behind it — ask for the minutes"),
    ("promised", "Promised, not yet sent"),
    ("waiting", "Waiting on a first reply"),
    ("nudge", "Silent past ten business days — nudge"),
    ("bounced", "Address is dead — find another"),
    ("done", "Settled"),
]
LABEL = dict(STAGES)


def load():
    return json.load(open(REQ))


def business_days_since(iso):
    if not iso:
        return 0
    d = datetime.date.fromisoformat(str(iso)[:10])
    n, today = 0, datetime.date.today()
    while d < today:
        d += datetime.timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def last_reply(r):
    reps = r.get("replies") or []
    return reps[-1] if reps else None


def stage(r):
    """One thread, one stage, and the reason in plain words."""
    st = r.get("status")
    rep = last_reply(r)
    kinds = [x.get("kind") for x in (r.get("replies") or [])]
    if st == "bounced":
        return "bounced", "the address bounced"
    if st == "closed":
        return "done", r.get("closed_reason", "closed")[:70]
    if r.get("kind") == "research" and st != "answered":
        return "research", f"{r.get('state')} · {business_days_since(r.get('sent_at'))} business days" + (f" · {len(r.get('replies') or [])} repl" if r.get("replies") else "")
    if r.get("kind") == "state_doe" and st != "answered":
        return "agency", f"{business_days_since(r.get('sent_at'))} business days" + (f" · {len(r.get('replies') or [])} repl" if r.get("replies") else "")
    if st in ("answered", "no_policy", "recorded"):
        return "done", f"recorded {r.get('recorded_status') or 'from their document'}"
    if r.get("residency_required") and not r.get("proxy_sent_at"):
        want = r.get("residency_proof_accepted")
        return "residency", (f"they accept: {want}" if want else "asked for proof of residency; we have not asked what they accept")
    if r.get("awaiting_link_since"):
        return "recheck", "we re-checked their site and asked for the direct link"
    if "website_no_link" in kinds and not r.get("rechecked_at"):
        return "recheck", "said it's on the website with no link; not re-checked yet"
    if r.get("claims_no_practice") and not r.get("minutes_requested_at"):
        return "escalate", "says the practice has stopped or was never written down"
    if st == "needs_review":
        return "needs_you", (rep or {}).get("kind") or "a reply the pipeline would not answer by itself"
    if st == "anthony_replied":
        return "needs_you", "you are in this thread"
    if st == "promised":
        return "promised", f"promised {business_days_since(r.get('sent_at'))} business days ago"
    if st == "sent":
        d = business_days_since(r.get("sent_at"))
        if d >= 10 and not r.get("followup_sent_at"):
            return "nudge", f"{d} business days, no reply"
        return "waiting", f"{d} business days"
    return "waiting", st or "?"


def board(reqs, state=None):
    rows = collections.defaultdict(list)
    for r in reqs:
        if state and r.get("state") != state:
            continue
        s, why = stage(r)
        rows[s].append((r, why))
    for k in rows:
        rows[k].sort(key=lambda x: -(x[0].get("kids") or 0))
    return rows


def nice(n):
    return n.title() if n.isupper() else n


def cli(reqs, state=None):
    rows = board(reqs, state)
    total = sum(len(v) for v in rows.values())
    kids_open = sum((r.get("kids") or 0) for k, v in rows.items() if k != "done" for r, _ in v)
    print(f"\n  SAFE SCHOOLS PROJECT · correspondence board{' · ' + state if state else ''}")
    print(f"  {total} districts written to · {len(rows['done'])} settled · {kids_open:,} children behind the open ones\n")
    for key, title in STAGES:
        v = rows.get(key) or []
        if not v:
            continue
        print(f"  {title.upper()}  ({len(v)})")
        for r, why in v[:40]:
            kids = f"{r.get('kids') or 0:>4}" if r.get("kids") else "   ·"
            print(f"    {kids}  {r['state']}  {nice(r['name'])[:38]:<38}  {why[:70]}")
        if len(v) > 40:
            print(f"         … and {len(v) - 40} more")
        print()


def digest(reqs):
    rows = board(reqs)
    parts = []
    for key, title in STAGES:
        v = rows.get(key) or []
        if v and key != "done" and key != "waiting":
            parts.append(f"{len(v)} {title.lower()}")
    done = len(rows.get("done") or [])
    head = f"Safe Schools Project: {done} settled, {sum(len(v) for k, v in rows.items() if k != 'done')} open."
    top = rows.get("needs_you") or []
    tail = ""
    if top:
        tail = " First: " + "; ".join(f"{nice(r['name'])} ({r['state']}) {why}" for r, why in top[:3]) + "."
    return head + (" " + ", ".join(parts) + "." if parts else "") + tail


def html(reqs):
    """A local board, and a public summary that carries no addresses."""
    rows = board(reqs)
    esc = lambda s: str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    out = ["""<!doctype html><meta charset="utf-8"><title>Correspondence board</title>
<style>body{background:#0B0F1E;color:#E8ECF1;font:14px/1.5 'IBM Plex Mono',ui-monospace,Menlo,monospace;margin:0;padding:24px}
h1{font-size:20px;margin:0 0 .2rem}h2{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#FDE68A;margin:1.6rem 0 .4rem;font-weight:400}
table{border-collapse:collapse;width:100%;margin-bottom:.5rem}td{padding:.25rem .5rem;border-bottom:1px solid #232B4A;vertical-align:top}
td.k{text-align:right;color:#FF6B6B;width:4rem}td.s{color:#8B95A5;width:2.5rem}td.n{color:#fff;width:22rem}td.w{color:#8B95A5}
.meta{color:#5E6A8A;margin:0 0 1rem}a{color:#7DD3FC}</style>"""]
    total = sum(len(v) for v in rows.values())
    out.append(f"<h1>Correspondence board</h1><p class=meta>{total} districts written to · generated {datetime.date.today()}</p>")
    for key, title in STAGES:
        v = rows.get(key) or []
        if not v:
            continue
        out.append(f"<h2>{esc(title)} ({len(v)})</h2><table>")
        for r, why in v:
            rep = last_reply(r) or {}
            out.append(f"<tr><td class=k>{r.get('kids') or ''}</td><td class=s>{esc(r['state'])}</td>"
                       f"<td class=n>{esc(nice(r['name']))}</td><td class=w>{esc(why)}"
                       + (f" · <a href=\"../../data/outreach/replies/{esc(r['id'])}/\">thread</a>" if r.get("replies") else "")
                       + "</td></tr>")
        out.append("</table>")
    p = os.path.join(ROOT, "out/outreach/board.html")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w").write("\n".join(out))

    # The public summary: what we asked and what came back, with no address and no private detail.
    pub = {"generated": datetime.date.today().isoformat(),
           "note": "Requests sent to school districts for their own written policy, and what came back. "
                   "Officials are named where they answered in their public capacity; addresses are not published.",
           "totals": {k: len(rows.get(k) or []) for k, _ in STAGES},
           "requests": [{"state": r["state"], "district": nice(r["name"]), "nces_id": r.get("nces_id"),
                         "kind": r.get("kind", "policy"), "sent": (r.get("sent_at") or "")[:10],
                         "stage": stage(r)[0], "why": stage(r)[1],
                         "replies": len(r.get("replies") or []),
                         "residency_required": bool(r.get("residency_required")),
                         "residency_proof_accepted": r.get("residency_proof_accepted"),
                         "recorded": r.get("recorded_status")}
                        for r in sorted(reqs, key=lambda x: -(x.get("kids") or 0))]}
    q = os.path.join(ROOT, "site/data/outreach.json")
    json.dump(pub, open(q, "w"))
    return p, q


if __name__ == "__main__":
    reqs = load()
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg == "digest":
        print(digest(reqs))
    elif arg == "html":
        a, b = html(reqs)
        print(f"wrote {a}\nwrote {b}")
    elif re.fullmatch(r"[A-Z]{2}", arg):
        cli(reqs, arg)
    else:
        cli(reqs)
