#!/usr/bin/env python3
"""Case folders: one folder per district, kept in the folder for its stage.

    cases/01-find/  02-verify/  03-ask/  04-certify/  05-change/  06-watch/  hold/
    cases/<stage>/OK-calumet/case.md       the record and where the case stands (rebuilt each run)
                              history.md   every message both ways, oldest first (rebuilt each run)
                              messages/    one file per message, the full text
                              log.md       stage moves and agents' notes (appended, never rewritten)
    cases/library/index.json               every document we hold, by sha256: path, district, source
    cases/BOARD.md                         how many cases sit in each stage, and today's moves

The stage is worked out from the district record (data/districts) and the ledger (data/outreach/requests.json);
this tool moves the folder when it changes and writes the move into log.md. Nothing here sends or edits a record.
cases/ holds superintendents' replies, so it is its own git repository, private, ignored by the public one
(2026-11-13, Anthony: "a folder for each district, a case file that moves between the other folders").

    python3 tools/cases/sync.py            build or update every case
    python3 tools/cases/sync.py --dry      say what would move
"""
import datetime, email, email.policy, glob, hashlib, json, os, re, shutil, subprocess, sys
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CASES = os.path.join(ROOT, "cases")
STAGES = ["01-find", "02-verify", "03-ask", "04-certify", "05-change", "06-watch", "hold"]
ASKS = {"policy", "formal_request", "state_doe", "research"}
LIVE = {"sent", "answered", "promised", "anthony_replied", "pending", "held"}
CERT_KINDS = {"certificate", "certificate_state", "certificate_reissue"}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def sha(path, cache):
    st = os.stat(path); key = f"{path}|{st.st_size}|{int(st.st_mtime)}"
    if key not in cache:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
        cache[key] = h.hexdigest()
    return cache[key]


def stage_of(d, rows):
    """Where the case stands. The record decides first; the threads decide for districts with no rule on file."""
    status = d.get("status")
    if any(r.get("unfiled_since") for r in rows): return "02-verify", "a document the district sent is not yet on the record"
    if status == "bans":
        certs = [r for r in rows if r.get("kind") in CERT_KINDS and r.get("status") in ("sent", "answered") and not r.get("retracted_at")]
        return ("06-watch", "ban on file, certificate sent") if certs else ("04-certify", "ban on file, no certificate yet")
    if status in ("allows", "consent_required"): return "05-change", f"the district's own document {'allows it with parental consent' if status == 'consent_required' else 'allows it'}"
    asks = [r for r in rows if r.get("kind", "policy") in ASKS and r.get("status") in LIVE]
    if asks: return "03-ask", f"asked the district ({len(asks)} open {'thread' if len(asks) == 1 else 'threads'}), no rule on file yet"
    return "01-find", "no rule on file and no open ask"


def next_action(stage, d, rows):
    if stage == "02-verify": return "read the document the district sent and file what it says"
    if stage == "04-certify": return "send the Safe School certificate on the board's own words"
    if stage == "05-change": return "next move from the change toolkit"
    if stage == "06-watch": return "recheck at the start of the next school year"
    if stage == "03-ask":
        last = max((r.get("followup_sent_at") or r.get("sent_at") or "" for r in rows if r.get("kind", "policy") in ASKS), default="")
        return f"wait for an answer; last ask {last[:10] or 'not yet sent'}"
    return "search the district's site and board portal again"


def eml_text(path):
    try:
        m = email.message_from_bytes(open(path, "rb").read(), policy=email.policy.default)
        part = m.get_body(preferencelist=("plain", "html"))
        body = part.get_content() if part else ""
        if part is not None and part.get_content_type() == "text/html": body = re.sub(r"<[^>]+>", " ", body)
        atts = [a.get_filename() for a in m.iter_attachments() if a.get_filename()]
        return {"from": str(m.get("From", "")), "date": str(m.get("Date", "")), "subject": str(m.get("Subject", "")), "body": body.strip(), "attachments": atts}
    except Exception as ex:
        return {"body": f"(could not read {os.path.basename(path)}: {ex!r})"}


def when(s):
    """An ISO time or an email Date header, as a sortable ISO string."""
    if not s: return ""
    if re.match(r"\d{4}-\d\d-\d\d", s): return s[:19]
    try: return email.utils.parsedate_to_datetime(s).astimezone().replace(tzinfo=None).isoformat()[:19]
    except Exception: return ""


def messages(rows):
    """Every message on every thread for one district, both ways, oldest first."""
    out = []
    for r in rows:
        k = r.get("kind", "policy")
        if r.get("sent_at") and r.get("status") not in ("pending", "held", "dropped"):
            out.append({"at": when(r["sent_at"]), "dir": "out", "kind": k, "row": r["id"], "to": r.get("to"), "subject": r.get("subject") or "", "body": r.get("body") or "(text not kept for this send; it was built from the template of its kind)"})
        if when(r.get("followup_sent_at") or ""):   # "n/a" marks kinds that never get one
            out.append({"at": when(r["followup_sent_at"]), "dir": "out", "kind": k + " follow-up", "row": r["id"], "to": r.get("to"), "subject": "", "body": "(follow-up; text not kept)"})
        for o in r.get("our_messages") or []:
            out.append({"at": when(o.get("at")), "dir": "out", "kind": k + (" (Anthony)" if o.get("by") == "anthony" else " reply"), "row": r["id"], "to": o.get("to"), "subject": "", "body": o.get("text") or ""})
        rdir = os.path.join(ROOT, "data/outreach/replies", r["id"])
        for rep in r.get("replies") or []:
            e = eml_text(os.path.join(rdir, rep["file"])) if rep.get("file") and os.path.exists(os.path.join(rdir, rep["file"])) else {}
            out.append({"at": when(rep.get("date") or e.get("date")), "dir": "in", "kind": rep.get("kind") or "reply", "row": r["id"], "from": rep.get("from") or e.get("from"),
                        "subject": e.get("subject", ""), "body": e.get("body") or "(reply text not kept)", "attachments": e.get("attachments") or [], "read_as": rep.get("why")})
    return sorted(out, key=lambda m: m["at"] or "")


def write(path, text):
    """Write only when the text changed, so git sees real changes only."""
    if os.path.exists(path) and open(path, encoding="utf-8").read() == text: return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f: f.write(text)
    return True


def main():
    dry = "--dry" in sys.argv; now = datetime.datetime.now().isoformat(timespec="seconds")
    reqs = json.load(open(os.path.join(ROOT, "data/outreach/requests.json")))
    by_nces = {}
    for r in reqs: by_nces.setdefault(str(r.get("nces_id")), []).append(r)

    # The library: every document we hold, once, by content.
    os.makedirs(os.path.join(CASES, "library"), exist_ok=True)
    cache_p = os.path.join(CASES, "library/.sha-cache.json")
    cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
    lib = {}; docs_of = {}
    for p in sorted(glob.glob(os.path.join(ROOT, "data/policies/inbound/*/*"))):
        if not os.path.isfile(p): continue
        rel = os.path.relpath(p, ROOT); m = re.match(r"(\d{6,8})-", os.path.basename(p)); h = sha(p, cache)
        e = lib.setdefault(h, {"paths": [], "nces_ids": [], "bytes": os.path.getsize(p)})
        e["paths"].append(rel)
        if m and m.group(1) not in e["nces_ids"]: e["nces_ids"].append(m.group(1))
        if m: docs_of.setdefault(m.group(1), []).append((h, rel))

    # Where every case folder is now.
    where = {}
    for s in STAGES:
        for p in glob.glob(os.path.join(CASES, s, "*")):
            if os.path.isdir(p): where[os.path.basename(p)] = s

    seen_names = set(); moves = []; counts = {s: 0 for s in STAGES}
    for f in sorted(glob.glob(os.path.join(ROOT, "data/districts/*.yaml"))):
        y = yaml.safe_load(open(f)); st = y.get("state") or os.path.basename(f)[:2]
        for d in y.get("districts") or []:
            nid = str(d.get("nces_id") or ""); name = f"{st}-{slug(d['name'])}"
            if name in seen_names: name = f"{name}-{nid}"
            seen_names.add(name)
            rows = by_nces.get(nid, []) if nid else []
            stage, why = stage_of(d, rows); counts[stage] += 1
            was = where.get(name); here = os.path.join(CASES, stage, name)
            if was and was != stage:
                moves.append((name, was, stage, why))
                if not dry: shutil.move(os.path.join(CASES, was, name), here)
            if dry: continue
            log_p = os.path.join(here, "log.md")
            if not os.path.exists(log_p): write(log_p, f"# {d['name']}, {st}: log\n\n- {now[:16]} opened in {stage}: {why}\n")
            elif was and was != stage:
                with open(log_p, "a", encoding="utf-8") as lf: lf.write(f"- {now[:16]} moved {was} -> {stage}: {why}\n")

            msgs = messages(rows); evid = docs_of.get(nid, [])
            head = {"district": d["name"], "state": st, "nces_id": nid, "county": d.get("county"), "stage": stage, "why_here": why,
                    "status": d.get("status"), "policy_code": d.get("policy_code"), "quote": d.get("quote"), "source": d.get("source"),
                    "last_verified": str(d.get("last_verified") or "") or None, "next_action": next_action(stage, d, rows),
                    "threads": [r["id"] for r in rows], "evidence": [{"sha256": h, "path": p} for h, p in evid],
                    "messages": len(msgs), "last_message": msgs[-1]["at"] if msgs else None}
            body = ["---", yaml.safe_dump(head, sort_keys=False, allow_unicode=True, width=10**6).strip(), "---", "",
                    f"# {d['name']}, {st}", "", f"**Stage:** {stage}. {why[0].upper() + why[1:]}.", f"**Next:** {head['next_action']}.", ""]
            if d.get("quote"): body += [f"**Record:** {d.get('status')}" + (f", policy {d['policy_code']}" if d.get("policy_code") else "") + ".", "", f"> {d['quote']}", "", f"Source: {d.get('source')}", ""]
            else: body += [f"**Record:** {d.get('status') or 'none'}. {d.get('notes') or ''}".strip(), ""]
            if d.get("notes") and d.get("quote"): body += [f"Notes: {d['notes']}", ""]
            if evid: body += ["## Documents held", ""] + [f"- `{p}` (sha256 {h[:12]})" for h, p in evid] + [""]
            if rows: body += ["## Threads", ""] + [f"- {r['id']} {r.get('kind', 'policy')}, {r['status']}" + (f", sent {r['sent_at'][:10]}" if r.get("sent_at") else "") + (f", to {r.get('to')}" if r.get("to") else "") for r in rows] + [""]
            write(os.path.join(here, "case.md"), "\n".join(body))

            hist = [f"# {d['name']}, {st}: every message, oldest first", ""]
            keep = set()
            for i, m in enumerate(msgs, 1):
                fn = f"{(m['at'] or 'undated')[:10]}-{i:03d}-{m['dir']}-{slug(m['kind'])}.md"; keep.add(fn)
                who = f"to {m.get('to')}" if m["dir"] == "out" else f"from {m.get('from')}"
                hist.append(f"- {(m['at'] or 'undated')[:16]} {'OUT' if m['dir'] == 'out' else 'IN '} {m['kind']} {who}" + (f": {m['read_as'][:140]}" if m.get("read_as") else "") + f" ([text](messages/{fn}))")
                txt = [f"# {m['kind']}, {m['dir']}", "", f"- at: {m['at']}", f"- {who}", f"- thread: {m['row']}"] + ([f"- subject: {m['subject']}"] if m.get("subject") else []) + \
                      ([f"- attachments: {', '.join(m['attachments'])}"] if m.get("attachments") else []) + ([f"- read as: {m['read_as']}"] if m.get("read_as") else []) + ["", m["body"], ""]
                write(os.path.join(here, "messages", fn), "\n".join(txt))
            mdir = os.path.join(here, "messages")
            for old in (os.listdir(mdir) if os.path.isdir(mdir) else []):
                if old not in keep: os.remove(os.path.join(mdir, old))
            write(os.path.join(here, "history.md"), "\n".join(hist) + "\n")

    if dry:
        for n, a, b, w in moves: print(f"{n}: {a} -> {b} ({w})")
        print(f"{len(moves)} would move;", ", ".join(f"{s} {c}" for s, c in counts.items())); return
    json.dump(cache, open(cache_p, "w"))
    write(os.path.join(CASES, "library/index.json"), json.dumps(lib, indent=1, sort_keys=True) + "\n")
    board = ["# Cases", "", f"Updated {now[:16]}.", "", "| Stage | Cases |", "|---|---:|"] + [f"| {s} | {c} |" for s, c in counts.items()] + [""]
    if moves: board += [f"## Moved this run ({len(moves)})", ""] + [f"- {n}: {a} -> {b}, {w}" for n, a, b, w in moves] + [""]
    write(os.path.join(CASES, "BOARD.md"), "\n".join(board))
    write(os.path.join(CASES, ".gitignore"), "library/.sha-cache.json\n")
    if not os.path.isdir(os.path.join(CASES, ".git")): subprocess.run(["git", "init", "-q"], cwd=CASES)
    subprocess.run(["git", "add", "--", ".gitignore", "BOARD.md", "library/index.json"] + [s for s in STAGES if os.path.isdir(os.path.join(CASES, s))], cwd=CASES, capture_output=True)   # named paths only, never add -A
    msg = f"{len(moves)} moved" + (": " + ", ".join(f"{n} {a}->{b}" for n, a, b, _ in moves[:5]) if moves else "")
    c = subprocess.run(["git", "commit", "-q", "-m", msg], cwd=CASES, capture_output=True, text=True)
    print(f"cases: {sum(counts.values())} districts; " + ", ".join(f"{s} {c}" for s, c in counts.items()) + f"; {len(moves)} moved" + ("" if c.returncode == 0 else " (nothing new to commit)"))


if __name__ == "__main__":
    main()
