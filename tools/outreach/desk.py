"""The desk, worked by the loop instead of by a person.

Until 2026-10-30 a reply the referee declined twice sat under "needs_review" until Anthony read it; 31 were
sitting there, most of them thank-yous for documents that had already been filed. Anthony: "I don't want
anything really on my desk." So nothing rests here. Every parked thread is taken up again each cycle, a few
at a time, and leaves in one of three ways: a reply that two readers (Jev, then Fable) accept; a close with
no reply when the thread needs none, or asks us to stop, or has had three tries; or a note that Anthony is
in the thread himself. The fee line, the stop-writing line and the residency rule are applied as rules, not
raised as questions.

    python3 tools/outreach/run.py desk          # work the whole backlog now (the cycle does four a pass)
    python3 tools/outreach/run.py desk --dry    # show what it would do
"""
import datetime, email, json, os, re, time
from email.header import decode_header, make_header
import run, writer as W, triage as T, messages

PER_CYCLE = 2       # each thread costs two to four model calls, a few minutes; the backlog is worked by hand (run.py desk)
MAX_TRIES = 3
FEE_LINE = 5.0
HARD = {"contradicts", "reverses"}   # where Jev is reliable; the soft four (answers, promises, tone, minor) it misreads often enough that a second reader can overrule it

STOP = re.compile(r"stop (contacting|emailing|writing)|do not contact|unsubscribe|cease|desist|harass|attorney|lawyer|legal action", re.I)
COMPLAINT = re.compile(r"complaint against|report you|inappropriate|unprofessional|spam", re.I)


def fee_quoted(text):
    amts = [float(a.replace(",", "")) for a in re.findall(r"\$\s*(\d[\d,]*(?:\.\d+)?)", text or "")]
    return max(amts) if amts else 0.0


def latest_eml(r, e):
    path = os.path.join(run.REPLIES, r["id"], e.get("file") or "")
    if not e.get("file") or not os.path.exists(path): return None, "", []
    msg = email.message_from_bytes(open(path, "rb").read())
    body, atts = run.part_text(msg)
    subject = str(make_header(decode_header(msg.get("Subject") or ""))) or r.get("subject") or (messages.nice(r["name"]) + " corporal punishment policy")
    return msg, body, atts


def directive_for(r, e, body, record, thread):
    """What the rules say before any model is asked. Returns (close_reason or None, note for the writer)."""
    plain = T.strip_quoted(body)
    notes = []
    if STOP.search(plain):
        return "they asked us to stop, or brought in counsel: no reply, no further contact", None
    if COMPLAINT.search(plain) and not STOP.search(plain):
        notes.append("They are unhappy with how we have written to them. One or two sentences: a plain apology for the volume or tone, no defense, no new ask. Then stop.")
    fee = fee_quoted(plain)
    if fee > FEE_LINE:
        notes.append(f"A fee of about ${fee:g} is quoted, above our ${FEE_LINE:g} line (the whole campaign's copying budget is $100). Do not accept it. Ask them to provide first whatever exists electronically at no charge (the board policy and the handbook are normally published files) and to itemize the rest; say plainly we will not be paying for the paid portion for now.")
    if r.get("residency_required") or (e.get("kind") == "residency_required"):
        if r.get("residency_asked_at"):
            return "they require a resident and we have already asked what proof they accept; noted for the exchange", None
        notes.append("They say only a resident may ask. Ask in one line what proof of residency they accept, thank them, and nothing else (move ask_residency_proof).")
    their = sum(1 for m in thread if m["who"] == "them")
    if r.get("invited_policy_at"): notes.append(f"The board was already invited to adopt a written prohibition on {r['invited_policy_at']}: do not invite again.")
    if r.get("formal_requested_at"): notes.append(f"A formal records request already went out on {r['formal_requested_at']}: do not send another.")
    if record.get("status") == "bans": notes.append("The record already shows a written prohibition: no invitation, no minutes request.")
    if their > 1: notes.append("This is not their first reply: do not ask for minutes.")
    docs = bool(e.get("filed") and e.get("filed") != ["nothing"]) or any(x.get("filed") and x.get("filed") != ["nothing"] for x in r.get("replies") or [])
    if docs: notes.append("A document is already in the thread and filed: thank, do not ask for a link, do not send a formal request.")
    return None, " ".join(notes)


def apply_move(r, e, move):
    today = datetime.date.today().isoformat()
    if move == "thank_recorded": r["status"] = "answered"
    elif move == "ask_link": r["awaiting_link_since"] = today; r["status"] = "sent"
    elif move == "ask_residency_proof": r["residency_asked_at"] = today; r["status"] = "sent"
    elif move == "ask_minutes": r["minutes_requested_at"] = today; r["status"] = "sent"; r["claim"] = "the district does not use corporal punishment"
    elif move == "invite_policy": r["invited_policy_at"] = today; r["status"] = "sent"; r["claim"] = "the district does not use corporal punishment"
    elif move == "records_request": r["formal_requested_at"] = today; r["status"] = "sent"
    else: r["status"] = "answered" if (e.get("filed") and e.get("filed") != ["nothing"]) else "sent"


def drop_draft(M, subject):
    """The IMAP session is often dead by now (minutes of model calls); reconnect once."""
    want = "Re: " + " ".join(str(subject).split())
    try: run.delete_draft(M, want); return
    except Exception: pass
    try:
        M2 = run.imap(); run.delete_draft(M2, want)
        try: M2.logout()
        except Exception: pass
    except Exception as ex: run.log("desk: could not drop the draft", repr(ex)[:80])


def overrule_ok(fails, j):
    """A second reader may overrule the first on the soft questions outright, and on the factual ones only by a small margin."""
    return bool(j) and j.get("ok") and all(k not in HARD or m < 0.15 for k, m in fails)


def close(r, e, why, M=None, subject=None):
    e["move"] = "close"; e["why"] = f"desk: {why}"; e["action"] = (e.get("action") or "") + f"; desk closed it: {why}"
    if STOP.search(why): r["do_not_contact"] = True; r["status"] = "closed"
    else: r["status"] = "answered" if (e.get("filed") and e.get("filed") != ["nothing"]) else "sent"
    if subject: drop_draft(M, subject)
    run.dlog(id=f"reply:{r['id']}", action="close", by="desk", outcome=why)


def work(M, reqs, mine, limit=PER_CYCLE, dry=False, deadline=None):
    done = 0
    todo = [r for r in reqs if r.get("status") == "needs_review" and r.get("replies")]
    todo.sort(key=lambda r: (r.get("desk_tries") or 0, r.get("last_reply_at") or ""))
    for r in todo:
        if done >= limit: break
        if deadline and time.time() > deadline: run.log("desk: out of time, the rest wait a cycle"); break
        e = r["replies"][-1]
        if r.get("hold_replies"):   # Anthony's own replies are context, not a lock (2026-10-09); only hold_replies parks a thread
            r["status"] = "anthony_replied"; e["action"] = (e.get("action") or "") + "; desk: thread held by hand"
            if not dry: run.save(reqs)
            continue
        msg, body, atts = latest_eml(r, e)
        subject = (str(make_header(decode_header(msg.get("Subject") or ""))) if msg else None) or r.get("subject") or (messages.nice(r["name"]) + " corporal punishment policy")
        thread = run.thread_of(r, reqs); record = run.record_status(r)
        reason, note = directive_for(r, e, body or e.get("text") or "", record, thread)
        r["desk_tries"] = (r.get("desk_tries") or 0) + 1; done += 1
        if reason:
            run.log("desk: close", r["state"], r["name"], reason[:80])
            if not dry: close(r, e, reason, M, subject); run.save(reqs)
            continue
        filed_desc = [{"says": f} for f in (e.get("filed") or []) if f not in ("nothing", "held")]
        facts = e.get("facts") or {}
        recheck = {"found": None, "looked_at": r.get("recheck_tried") or []} if r.get("rechecked_at") else None
        objections = f"An earlier draft was set aside: {e.get('why')}" if e.get("why") else ""
        draft, move, why = e.get("suggested"), (e.get("move") if e.get("move") not in (None, "hold", "close") else None), e.get("why") or ""
        outcome = None; fixed_last = False
        for attempt in range(MAX_TRIES + 1):
            if not draft or not move or (attempt and not fixed_last):
                if attempt > MAX_TRIES - 1: break
                d = W.decide(r, thread, record, filed_desc, facts, recheck, False, note=" ".join(x for x in (note, objections) if x))
                if not d: objections = f"the writer returned nothing ({W.LAST_ERROR[0]})"; continue
                draft, move, why = d["reply"], d["move"], d["why"]
            fixed_last = False
            if move == "hold" or not draft:
                if re.search(r"acknowledg|no reply needed|nothing to answer|no response needed|pleasantry|courtesy|sign-off|closes the thread|duplicat", why, re.I):
                    outcome = ("close", f"no reply needed: {why[:120]}"); break
                objections = f"The writer wanted to hold ({why}). Holding is not available: write the short accurate reply that settles it, or say in WHY that no reply is needed."; draft = None; continue
            if move == "forward" and not facts.get("redirect_to"): move = "answer"
            s = W.scores(draft, thread, record)
            if s is None: objections = "the referee could not be reached"; continue
            fails = W.failures(s)
            if not fails:
                outcome = ("send", f"referee passed on try {attempt + 1}"); break
            if attempt >= MAX_TRIES:   # the last draft was the second reader's own repair: its word stands on the soft questions
                if all(k not in HARD for k, _ in fails): outcome = ("send", f"second reader's repair; referee still marginal on {', '.join(k for k, _ in fails)}")
                break
            j = W.judge(draft, thread, record, fails)
            if overrule_ok(fails, j):
                outcome = ("send", f"referee flagged {', '.join(k for k, _ in fails)}; second reader passed it"); break
            objections = "A reader flagged the draft: " + "; ".join(f"{k} (score {s[k]:.2f})" for k, _ in fails) + ((". Second reader: " + j["problems"]) if j and j.get("problems") else "") + ". Fix exactly that and keep the rest."
            if j and j.get("fixed"): draft = j["fixed"]; fixed_last = True; continue
            draft = None
        if not outcome:
            outcome = ("close", f"no passing reply after {MAX_TRIES} tries; last objection: {objections[:160]}")
        what, detail = outcome
        if dry:
            run.log(f"desk (dry): would {what}", r["state"], r["name"], move or "", detail[:100]); print(f"\n== {r['state']} {r['name']} -> {what} ({move}) {detail}\n{draft or ''}")
            continue
        if what == "close":
            close(r, e, detail, M, subject)
        else:
            to = facts.get("redirect_to") if move == "forward" else None
            if run.reply_to(r, e.get("from"), e.get("message_id"), subject, draft, to=to):
                e["our_reply"] = draft; e["move"] = move; e["why"] = f"desk: {detail}; {why}"; e["action"] = (e.get("action") or "") + f"; desk replied ({move})"
                if to: r["to"] = to
                apply_move(r, e, move)
                drop_draft(M, subject)
                run.dlog(id=f"reply:{r['id']}", action="send", by="desk", outcome=f"{move}: {detail}")
                run.log("desk: replied", r["state"], r["name"], move, detail[:80])
            else:
                run.log("desk: send failed", r["state"], r["name"])
        run.save(reqs)
    return done
