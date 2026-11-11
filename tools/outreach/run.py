#!/usr/bin/env python3
"""Records requests to districts, and the back-and-forth after.

    run.py send [N]     send up to N pending requests (default 25), deleting the matching Gmail draft
    run.py inbox        read replies, file documents into the record, answer the routine cases,
                        draft the rest for Anthony
    run.py followup     one nudge to anyone silent for ten business days
    run.py cycle        all three, in that order (what launchd runs every hour)

State lives in data/outreach/requests.json; every reply is kept raw under data/outreach/replies/.
A model never writes to the record here: a document that arrives goes through the same
clip-and-classify pipeline as everything else, and the only messages sent without a person are
the two templated ones (a thank-you when a document arrives; the in-kind grant offer when a
district says it has no written policy). Everything else becomes a Gmail draft and a text to
Anthony.
"""
import sys, os, json, re, time, imaplib, smtplib, email, email.utils, hashlib, subprocess, datetime, html as htmlmod, urllib.request
import socket, signal
# A cycle hung for a week on an IMAP socket with no timeout (2026-10-19 to 10-26) and, holding the lock, stopped
# every cycle behind it. Every socket times out, and a cycle that outlives its slot is killed before the next one.
socket.setdefaulttimeout(120)
CYCLE_DEADLINE = float('inf')   # set by the cycle command once it holds the lock
from email.message import EmailMessage
from email.header import decode_header, make_header

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REQ = os.path.join(ROOT, "data/outreach/requests.json")
REPLIES = os.path.join(ROOT, "data/outreach/replies")
INBOUND = os.path.join(ROOT, "data/policies/inbound")
LOGDIR = os.path.join(ROOT, "out/outreach")
RAW = "https://raw.githubusercontent.com/AnthonyDavidAdams/end-school-corporal-punishment/main/"
os.makedirs(REPLIES, exist_ok=True); os.makedirs(INBOUND, exist_ok=True); os.makedirs(LOGDIR, exist_ok=True)

cfg = dict(l.strip().split("=", 1) for l in open(os.path.expanduser("~/inbox-brief/config.env")) if "=" in l and not l.startswith("#"))
USER = cfg["IMAP_USER"].strip().strip('"'); PW = cfg["IMAP_PASSWORD"].strip().strip('"'); SMS = cfg.get("SMS_RECIPIENT", "").strip().strip('"')
FROM = f"Anthony Adams <{USER}>"
def jev_key():
    for l in open(os.path.expanduser("~/personality-bench/.env.local")):
        if l.startswith("OPENROUTER"): return l.split("=", 1)[1].strip().strip('"')
LOG = open(os.path.join(LOGDIR, datetime.date.today().isoformat() + ".log"), "a")
def log(*a):
    s = f"{datetime.datetime.now().strftime('%H:%M:%S')} " + " ".join(str(x) for x in a); print(s); LOG.write(s + "\n"); LOG.flush()

def load(): return json.load(open(REQ))
def save(reqs):
    # Written beside the ledger and renamed over it: a kill mid-write (the 13-minute watchdog, a reboot)
    # used to be able to leave a truncated 5 MB file, and the ledger is the only record of what was sent.
    tmp = REQ + ".tmp"
    with open(tmp, "w") as f:
        json.dump(reqs, f, indent=1); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, REQ)
def business_days_since(iso):
    if not iso: return 0
    d = datetime.date.fromisoformat(iso[:10]); n = 0; today = datetime.date.today()
    while d < today:
        d += datetime.timedelta(days=1)
        if d.weekday() < 5: n += 1
    return n
def nice(name): return name.title() if name.isupper() else name

# ---------------------------------------------------------------- mail plumbing
def smtp_send(msg):
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(USER, PW); s.send_message(msg)
def imap():
    M = imaplib.IMAP4_SSL("imap.gmail.com"); M.login(USER, PW); return M
def delete_draft(M, subject):
    # The job stopped writing drafts on 2026-10-31. Since then the only drafts under these subjects are
    # the ones Anthony wrote by hand, and a substring match on the subject would delete them.
    if not GMAIL_DRAFTS: return
    M.select('"[Gmail]/Drafts"'); typ, data = M.search(None, "SUBJECT", f'"{subject}"')
    for num in (data[0].split() if data and data[0] else []):
        M.store(num, "+FLAGS", "\\Deleted")
    M.expunge()
GMAIL_DRAFTS = False   # 2026-10-31: the desk sends or closes every held reply itself; no more drafts in Anthony's Gmail
def put_draft(M, msg):
    if not GMAIL_DRAFTS: return
    M.append('"[Gmail]/Drafts"', "\\Draft", imaplib.Time2Internaldate(time.time()), msg.as_bytes())
def text_anthony(line):
    if not SMS: return
    try:
        subprocess.run(["osascript", "-e", f'tell application "Messages" to send {json.dumps(line)} to buddy {json.dumps(SMS)} of (service 1 whose service type is iMessage)'], timeout=20, capture_output=True)
    except Exception as e: log("text failed", e)

def alert(key, line):
    """Tell Anthony once a day per key, however many cycles see the same thing. Search being down texted
    him every fifteen minutes for three days (258 times) before this; most other failures told him nothing."""
    log("ALERT", key + ":", line)
    path = os.path.join(LOGDIR, "alerts.json"); today = datetime.date.today().isoformat()
    try: seen = json.load(open(path))
    except Exception: seen = {}
    if seen.get(key) == today: return
    seen[key] = today
    try:
        with open(path + ".tmp", "w") as f: json.dump(seen, f)
        os.replace(path + ".tmp", path)
    except Exception as e: log("alert memory failed", e)
    text_anthony(line)

def stop_sets(reqs):
    """Districts and addresses nothing new may go to: a district that asked us to stop, and a thread
    Anthony has taken over by hand. desk.py set do_not_contact and nothing ever read it."""
    ids, addrs = set(), set()
    for r in reqs:
        if r.get("do_not_contact") or r.get("hold_replies"):
            if r.get("nces_id"): ids.add(str(r["nces_id"]))
            for a in (r.get("to"), r.get("answered_from")):
                if a: addrs.add(a.lower())
    return ids, addrs

# ---------------------------------------------------------------- the messages
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import messages, triage as triage_mod, recheck as recheck_mod, writer as writer_mod
# The game (tools/game): which variant of a message a district gets, and the ledger of moves. Never fatal to the cycle.
sys.path.insert(0, os.path.join(ROOT, "tools/game"))
try: import assign as game_assign, ledger as game_ledger
except Exception as _ex: game_assign = game_ledger = None; log("game modules unavailable", repr(_ex)[:80])

def ensure_compliment(r):
    """One true, specific line about the district from its own recent news (compliment.py), looked up once
    per request and kept on the record so a follow-up can reuse it. None is a valid answer."""
    if "compliment" in r: return r["compliment"]
    try:
        import compliment
        r["compliment"] = compliment.compliment(r["name"], r["state"])
    except Exception as e:
        log("compliment failed", r["name"], e); r["compliment"] = None
    return r["compliment"]

def subject_for(r):
    if game_assign and r.get("variant"):
        s = game_assign.subject(r)
        if s: return s       # a templated variant (B); variant A is the copy below
    d = nice(r["name"])
    return {
        "policy":   f"{d} corporal punishment policy",
        "minutes":  f"Records request: {d} board minutes on corporal punishment",
        "research": f"Records request: what {d}'s board relied on",
        "state_doe": f"Records request: district contacts, handbooks and discipline data",
        "align":    f"An invitation: {d} as a Safe School for 2026-27",
        "board_note": f"{d}: a four-minute film for the board",
        "neighbor": f"{d} corporal punishment policy",
        "apology": "Sorry for the repeat emails",
        "certificate_correction": f"A correction on the {d} certificate",
        "certificate_reissue": f"A clean copy of the {d} certificate",   # only when the certificate's thread is gone; it normally goes out as "Re:" on that thread
        "retraction": f"A correction on {d}",   # only when the thread it corrects is gone; it normally goes out as "Re:" on that thread
        "formal_request": f"Records request: {d} corporal punishment policy",   # only when the first ask's thread is gone; it normally goes out as "Re:" on that thread
    }.get(r.get("kind", "policy"), f"Can't find {d}'s corporal punishment policy")

def body_for(r):
    if game_assign and r.get("variant"):
        b = game_assign.body(r)
        if b: return b
    k = r.get("kind", "policy")
    statute = r.get("statute") or "your state's public records law"
    if k == "minutes":
        return messages.ask_minutes(r, USER, statute, r.get("claim", "the practice has stopped"))
    if k == "research":
        return messages.ask_research(r, USER, statute)
    if k == "state_doe":
        return messages.state_doe(r.get("state_name", r["state"]), r["state"], statute, USER, r.get("dept", "department of education"))
    if k == "align":
        return messages.align_policy(r, USER, r.get("quote"), r.get("policy_code"))
    if k == "board_note":
        if not r.get("wrote_sup_at") and r.get("parent_request"):
            parent = next((p for p in load() if p["id"] == r["parent_request"]), None)
            if parent and parent.get("sent_at"): r["wrote_sup_at"] = parent["sent_at"]
        return messages.board_note(r, USER, r.get("link") or "https://earthpilot.org/kids/board/")
    if k == "apology":
        return messages.apology(r, USER)
    if k == "certificate_correction":
        return messages.certificate_correction(r, USER)
    if k == "retraction":
        return messages.retraction(r, USER, record_status(r))
    if k == "certificate_reissue":
        return messages.certificate_reissue(r, USER)
    if k == "neighbor":
        return messages.neighbor_ask(r, USER, r.get("anchor") or "a neighboring district")
    if k == "formal_request":
        return messages.formal_request(r, USER, statute)
    return messages.ask_policy(r, USER, r.get("compliment"))

# ---------------------------------------------------------------- send
def record_move(r):
    """One line in the game ledger (data/game/moves.jsonl) per message sent, with its experiment and variant."""
    if not game_ledger: return
    try: game_ledger.record_move(r)
    except Exception as ex: log("ledger failed", r.get("name"), repr(ex)[:80])

def when_ts(d):
    """A timestamp from either date shape the ledger keeps (RFC 2822 from mail, ISO from us); 0 when unreadable."""
    try:
        return email.utils.parsedate_to_datetime(d).timestamp() if d and "," in str(d) else datetime.datetime.fromisoformat(str(d)[:19]).timestamp()
    except Exception:
        return 0

def last_contact(address, reqs, exclude=None):
    """When we last wrote to this address, across every request: first sends, nudges, replies, Anthony's own
    mail. The one number behind the cooldown: nothing new goes to one address twice in a day unless it
    answers their latest message (Milan got two replies in 42 seconds and a certificate 22 minutes later)."""
    address = (address or "").lower(); best = 0
    for r in reqs:
        if r.get("id") == exclude or (r.get("to") or "").lower() != address: continue
        for d in (r.get("sent_at"), r.get("followup_sent_at")): best = max(best, when_ts(d))
        for e in r.get("replies") or []:
            if e.get("our_reply"): best = max(best, when_ts(e.get("date")))
        for o in r.get("our_messages") or []: best = max(best, when_ts(o.get("at")))
    return best

HOLD_NEW = False   # 2026-10-30, Anthony: "I don't want anything really on my desk". New batches go pending; only an unapproved experiment variant is held.
STOP_EXEMPT = ("apology", "certificate_correction")   # these answer a thread of ours, even one a district has closed
COOLDOWN_EXEMPT = STOP_EXEMPT + ("retraction", "certificate_reissue")   # these must not wait a day; a retraction or a reissue still honors a stop request

def send(limit=25):
    reqs = load(); M = imap(); n = 0; cooled = 0; stop_ids, stop_addrs = stop_sets(reqs); stopped = 0
    for r in reqs:
        if r["status"] != "pending" or n >= limit: continue
        if r.get("kind") not in STOP_EXEMPT and (str(r.get("nces_id") or "") in stop_ids or (r.get("to") or "").lower() in stop_addrs):
            stopped += 1; continue   # stays pending and unsent; cleared only when the stop or the hold is lifted
        if r.get("kind") not in COOLDOWN_EXEMPT and time.time() - last_contact(r.get("to"), reqs, exclude=r["id"]) < 24 * 3600:
            cooled += 1; continue   # stays pending; the next cycle after the day is up sends it
        if r.get("kind") == "formal_request":
            parent = next((p for p in reqs if p["id"] == r.get("parent_request")), None)
            why = formal_moot(parent, reqs) if parent else "the first ask is no longer on file"
            if why:   # the district answered, or the policy turned up, while this waited: a formal request now would be wrong
                r["status"] = "dropped"; r["dropped_why"] = why; save(reqs); log("formal request dropped", r["state"], r["name"], "-", why); continue
        if r.get("kind", "policy") == "policy":
            # Asking "where does your policy live" when we already hold it reads as not having looked. A harvest
            # can land between the queue and the send (five Kansas and Kentucky asks on 2026-11-11 did this).
            now = record_status(r)
            if now.get("quote") and now.get("status") in ("bans", "allows", "consent_required"):
                r["status"] = "dropped"; r["dropped_why"] = f"the policy turned up before this was sent (record: {now['status']}, {now.get('policy_code') or 'no code'})"; save(reqs)
                log("policy ask dropped", r["state"], r["name"], "- the record already has the policy"); continue
        if r.get("kind") == "certificate_reissue":
            # The note says a clean copy is attached. If the file is not on this machine (out/ is not in git),
            # nothing goes: the row waits on the desk instead of sending a promise with nothing behind it.
            gone = [a["path"] if isinstance(a, dict) else a for a in r.get("attachments") or [] if not os.path.exists(os.path.join(ROOT, a["path"] if isinstance(a, dict) else a))]
            parent = next((p for p in reqs if p["id"] == r.get("parent_request")), None)
            why = "no clean certificate is attached" if not r.get("attachments") else f"the clean certificate file is missing ({gone[0]})" if gone else "the certificate it replaces was withdrawn" if (parent or {}).get("retracted_at") else None
            if why:
                r["status"] = "error"; r["error"] = why; save(reqs); log("reissue not sent", r["state"], r["name"], "-", why)
                alert("reissue-blocked", f"ESCP: a clean certificate for {r['name']} was not sent ({why}). The row is marked error and will not retry by itself."); continue
        subject = r.get("subject") or subject_for(r)
        r["subject"] = subject; r.setdefault("kind", "policy")
        if r["kind"] not in ("formal_request", "retraction", "certificate_reissue"): ensure_compliment(r)
        mid = f"<escp-{r['id']}@earthpilot.org>"
        m = EmailMessage(); m["From"] = FROM; m["To"] = r["to"]; m["Subject"] = subject; m["Message-ID"] = mid
        m["Date"] = email.utils.formatdate(localtime=True); m["X-ESCP-Request"] = r["id"]; r["body"] = body_for(r); m.set_content(r["body"])
        if r.get("kind") in ("apology", "certificate_correction", "retraction", "certificate_reissue", "formal_request") and r.get("parent_request"):   # lands in the thread it corrects or continues
            parent = next((p for p in reqs if p["id"] == r["parent_request"]), None)
            if parent and parent.get("message_id"):
                m["In-Reply-To"] = parent["message_id"]; m["References"] = parent["message_id"]
                del m["Subject"]; subject = "Re: " + re.sub(r"^(re:\s*)+", "", parent.get("subject") or subject_for(parent), flags=re.I); m["Subject"] = subject; r["subject"] = subject
        for att in r.get("attachments") or []:   # a path under the project, or {"path", "name"} when the file should arrive under a readable name
            pth = os.path.join(ROOT, att["path"] if isinstance(att, dict) else att)
            if os.path.exists(pth):
                sub = "pdf" if pth.endswith(".pdf") else "vnd.openxmlformats-officedocument.wordprocessingml.document" if pth.endswith(".docx") else "octet-stream"
                m.add_attachment(open(pth, "rb").read(), maintype="application", subtype=sub, filename=(isinstance(att, dict) and att.get("name")) or os.path.basename(pth))
        try:
            smtp_send(m)
        except Exception as e:
            log("SEND FAILED", r["name"], e); r["status"] = "error"; r["error"] = str(e)[:200]; save(reqs)
            alert("send-failed", f"ESCP: a send failed ({str(e)[:80]}). The request is marked error and will not retry by itself."); continue
        # Delivered. Saved before anything else can fail: a draft cleanup that threw here used to mark a
        # delivered email "error".
        r["status"] = "sent"; r["sent_at"] = datetime.datetime.now().isoformat(timespec="seconds"); r["message_id"] = mid; n += 1; save(reqs)
        log("sent", r["state"], r["name"], "->", r["to"])
        if r.get("kind") == "certificate_reissue":   # the certificate's own row says a clean copy followed, and a bounce retry attaches the clean file
            parent = next((p for p in reqs if p["id"] == r.get("parent_request")), None)
            if parent: parent["reissued_at"] = datetime.date.today().isoformat(); save(reqs)
        if r.get("kind") == "formal_request":   # the first ask's thread carries the fact, so the desk never sends a second one and a reply is read against it
            parent = next((p for p in reqs if p["id"] == r.get("parent_request")), None)
            if parent:
                parent["formal_requested_at"] = datetime.date.today().isoformat()
                parent.setdefault("our_messages", []).append({"at": r["sent_at"], "kind": "formal_request", "text": r["body"]}); save(reqs)
        try: delete_draft(M, subject); record_move(r)
        except Exception as e: log("after-send bookkeeping failed", r["name"], repr(e)[:100])
        time.sleep(8)
    try: M.logout()   # the mailbox sometimes hangs up first after a long batch; every send above is already saved
    except Exception: pass
    log(f"send: {n} sent, {sum(1 for r in reqs if r['status']=='pending')} still pending" + (f", {cooled} waiting on the 24-hour cooldown" if cooled else "") + (f", {stopped} withheld (district asked us to stop, or Anthony holds the thread)" if stopped else ""))

# ---------------------------------------------------------------- inbox

LABEL = "Safe Schools"
def ensure_label(M):
    try: M.create(f'"{LABEL}"')
    except Exception: pass
def file_away(M, num):
    """Label a message and take it out of the inbox. Gmail's IMAP exposes labels as X-GM-LABELS."""
    # Removing the \Inbox label over IMAP did not stick (the same 55 messages were "archived" every hour for
    # four days). Deleting from INBOX is how Gmail's IMAP archives; the label keeps the message.
    try:
        M.store(num, "+X-GM-LABELS", f'"{LABEL}"'); M.store(num, "+FLAGS", "\\Seen"); M.store(num, "+FLAGS", "\\Deleted"); return True
    except Exception as e:
        log("label failed", repr(e)[:80]); return False
def file_away_by_mid(M, mid):
    """Label and archive the INBOX copy of one message, then return to All Mail. A \\Deleted flag set while
    All Mail is selected would trash the message, so the inbox loop never files by its own sequence numbers."""
    try:
        M.select("INBOX"); typ, d = M.search(None, "HEADER", "Message-ID", f'"{mid}"')
        for n in (d[0].split() if d and d[0] else []): file_away(M, n)
    except Exception as e:
        log("file_away_by_mid failed", repr(e)[:80])
    finally:
        M.select('"[Gmail]/All Mail"')
def tidy():
    """One pass over the inbox: every message that belongs to a request thread gets the label and leaves the inbox."""
    reqs = load(); M = imap(); ensure_label(M); M.select("INBOX"); moved = 0
    typ, data = M.search(None, "X-GM-RAW", '"newer_than:90d (subject:corporal OR subject:\\"records request\\" OR subject:\\"relied on\\" OR subject:handbook OR subject:\\"discipline data\\" OR subject:\\"safe schools\\")"')
    for num in (data[0].split() if data and data[0] else []):
        typ, raw = M.fetch(num, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT IN-REPLY-TO REFERENCES MESSAGE-ID)])"); h = email.message_from_bytes(raw[0][1])
        frm = email.utils.parseaddr(h.get("From", ""))[1].lower()
        if "no-reply" in frm or "noreply" in frm or "substack" in frm or "medium.com" in frm: continue
        subj = str(h.get("Subject") or "")
        # A message is ours if it belongs to a request thread, or its subject is unmistakably the campaign's.
        # A sender-domain test used to be here too and swept in newsletters (Intercept, Brilianze, Print@).
        ours = find_request(h, reqs) or re.search(r"corporal punishment|safe schools project|records request: district", subj, re.I)
        if ours and file_away(M, num): moved += 1
    M.expunge(); M.logout(); log(f"tidy: {moved} messages labelled '{LABEL}' and archived"); return moved
def part_text(msg):
    texts = []; atts = []; hrefs = []
    for part in msg.walk():
        ct = part.get_content_type(); fn = part.get_filename()
        if fn: atts.append((str(make_header(decode_header(fn))), part.get_payload(decode=True) or b"", ct)); continue
        if ct.startswith("image/"):   # an inline picture with no name (a pasted screenshot); OCR'd in file_documents
            atts.append((f"inline-{len(atts) + 1}.{ct.split('/')[1].replace('jpeg', 'jpg')}", part.get_payload(decode=True) or b"", ct)); continue
        if ct == "text/plain": texts.append(part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "ignore"))
        elif ct == "text/html":
            h = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "ignore")
            # An iPhone mail is HTML only, and its attachment is an href behind a preview picture (Lake
            # Hamilton AR, 2026-10-27: a 1.9 MB policy PDF went unread because the tags were stripped).
            hrefs += [htmlmod.unescape(u) for u in re.findall(r'href="(https?://[^"]+)"', h) if "earthpilot" not in u and "mailto:" not in u]
            if not texts:
                h2 = re.sub(r"<br\s*/?>|</(p|div|li|tr|h[1-6]|blockquote)>", "\n", re.sub(r"<(script|style)[\s\S]*?</\1>", "", h), flags=re.I)
                texts.append(htmlmod.unescape(re.sub(r"<[^>]+>", " ", h2)))
    t = re.sub(r"[ \t]+", " ", "\n".join(texts)).strip()
    # drop our quoted request from the bottom of a reply
    t = re.split(r"\n(On .{5,80} wrote:|From: Anthony Adams|-----Original Message-----)", t)[0].strip()
    extra = [u for u in dict.fromkeys(hrefs) if u not in t and re.search(r"\.(pdf|docx?)(\?|$)|document|policy|handbook|drive\.google|dropbox|icloud", u, re.I)]
    if extra: t += "\n" + "\n".join(extra[:6])
    return t, atts
def find_request(msg, reqs):
    refs = (msg.get("In-Reply-To", "") + " " + msg.get("References", ""))
    m = re.search(r"escp-([0-9a-f]{10})@", refs)
    if m:
        hit = next((r for r in reqs if r["id"] == m.group(1)), None)
        if hit and hit.get("kind") == "formal_request" and hit.get("parent_request"):   # an answer to the formal request is an answer on the first ask's thread
            hit = next((r for r in reqs if r["id"] == hit["parent_request"]), None) or hit
        return hit
    # No thread header: the subject must be a reply to one of the exact subjects we sent. Nothing else counts.
    subj = re.sub(r"^\s*((re|fw|fwd|aw)\s*:\s*|unmonitored account\s*)+", "", str(make_header(decode_header(msg.get("Subject", "")))), flags=re.I).strip().lower()
    frm = email.utils.parseaddr(msg.get("From", ""))[1].lower(); dom = frm.split("@")[-1]
    def sent_subjects(r):
        s = {f"request for {nice(r['name']).lower()}'s corporal punishment policy"}
        if r.get("subject"): s.add(r["subject"].lower())
        return s
    hits = [r for r in reqs if r["status"] != "pending" and subj in sent_subjects(r)]
    if len(hits) == 1: return hits[0]
    if len(hits) > 1: return next((r for r in hits if r["to"].split("@")[-1].lower() == dom), None)
    return None
def jev_kind(subject, frm, body, atts, links):
    q = {"kind": {"type": "choice", "instructions": "What is this reply to a public-records request for a school district's corporal punishment policy?",
         "criteria": {"document": "The policy or handbook is attached, pasted in the body, or linked (a URL to the policy document or the policy page).",
                      "no_written_policy": "The district says it has no written policy on corporal punishment, or that the practice is not addressed anywhere in writing.",
                      "will_send_later": "They acknowledge the request and say it is being handled, forwarded, or will be answered later; nothing sent yet.",
                      "question_or_pushback": "They ask a question, want to know who we are, dispute the request, ask for a form, or push back in some way.",
                      "refusal_or_fee": "They refuse, cite an exemption, or demand a fee or in-person visit before releasing anything.",
                      "auto_reply_or_bounce": "An out-of-office, an automated acknowledgment, or a delivery failure.",
                      "other": "None of the above."}}}
    state = {"subject": subject, "from": frm, "body": body[:3000], "attachments": [a[0] for a in atts], "links": links[:10]}
    try:
        req = urllib.request.Request("https://openrouter.ai/api/alpha/decisions", data=json.dumps({"model": "typesafe/jev-1.13", "state": state, "questions": q}).encode(),
                                     headers={"Authorization": f"Bearer {jev_key()}", "Content-Type": "application/json"})
        j = json.load(urllib.request.urlopen(req, timeout=60)); a = j["answers"]["kind"]; return a["choice"], a.get("confidence", 0)
    except Exception as e:
        log("jev failed", e); return "other", 0
ANCH = re.compile(r"corporal punishment|corporal|paddl|spank|swat|licks", re.I)
NOT = ["physical restraint", "restraint and seclusion", "seclusion", "mechanical restraint", "chemical restraint", "self-defense", "imminent bodily harm"]
def clip(t): return [s for s in (re.sub(r"\s+", " ", x).strip() for x in re.split(r"(?<=[.:;])\s+", t)) if 30 < len(s) < 600 and ANCH.search(s) and not any(n in s.lower() for n in NOT)]
CORE = re.compile(r"corporal|paddl|spank", re.I)
def layer_problem(t):
    """Why a PDF's own text layer cannot be trusted, or None. Nemaha Central KS sent policy JDA and its layer
    read "Corpora l punishment sha ll not be per mitted"; Hancock Place MO sent JGA and its layer was control
    characters. Both were logged "document silent" (2026-10-27 and 28), both superintendents were thanked,
    and neither record was filled until the pages were read by eye on 2026-11-11."""
    s = (t or "").strip()
    if len(s) < 500: return "almost no text"
    body = re.sub(r"\s+", "", s)
    if sum(ch.isascii() and ch.isalpha() for ch in body) < 0.6 * len(body): return "the layer is not words"
    if len(CORE.findall(body)) > len(CORE.findall(s)): return "words split by stray spaces"
    return None
def pdf_pages(path):
    m = re.search(r"^Pages:\s+(\d+)", subprocess.run(["pdfinfo", path], capture_output=True, text=True).stdout, re.M)
    return int(m.group(1)) if m else 0
def doc_text(path):
    head = open(path, "rb").read(5)
    if head == b"%PDF-" and not path.lower().endswith(".pdf"):
        os.rename(path, path + ".pdf"); path = path + ".pdf"
    if path.lower().endswith((".html", ".htm")):
        raw = open(path, encoding="utf-8", errors="ignore").read()
        raw = re.sub(r"<(script|style|noscript)[\s\S]*?</\1>", " ", raw, flags=re.I)
        raw = re.sub(r"</(p|div|li|tr|h[1-6]|br|section|article)>", "\n", raw, flags=re.I)
        return htmlmod.unescape(re.sub(r"<[^>]+>", " ", raw))
    if path.lower().endswith(".pdf"):
        t = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True).stdout
        why = layer_problem(t)
        if why:
            # The page as printed outranks a layer that fails the check. A long document whose layer has text
            # is left alone (a 120-page handbook of tables is not worth ten minutes of a 13-minute cycle).
            thin = len(t.strip()) < 500; pages = pdf_pages(path)
            if not thin and pages > 60:
                log(f"pdf layer suspect ({why}), {pages} pages, too long to read by OCR:", os.path.basename(path)); return t
            side = path + ".txt"
            try: subprocess.run(["ocrmypdf", "--force-ocr", "--sidecar", side, "--quiet", path, "/dev/null"], capture_output=True, timeout=1200 if thin else 600)
            except subprocess.TimeoutExpired: log("pdf OCR timed out:", os.path.basename(path))
            o = open(side, encoding="utf-8", errors="ignore").read() if os.path.exists(side) else ""
            if o.strip() and (thin or len(ANCH.findall(o)) > len(ANCH.findall(t))):
                log(f"pdf read by OCR ({why}):", os.path.basename(path)); return o
        return t
    if path.lower().endswith((".docx", ".doc")):
        return subprocess.run(["textutil", "-convert", "txt", "-stdout", path], capture_output=True, text=True).stdout
    return open(path, encoding="utf-8", errors="ignore").read()
TOKENS = re.compile(r"(sk|pk)\.[A-Za-z0-9_\-\.]{40,}|AIza[0-9A-Za-z_\-]{35}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}")
def scrub(path):
    """A fetched web page can carry the district's own embedded API keys (a Mapbox token blocked a push on
    2026-10-12). They are not part of the record; strip them before the file is kept."""
    if not path.endswith((".html", ".htm", ".txt")): return
    try:
        t = open(path, errors="ignore").read(); t2 = TOKENS.sub("[token removed]", t)
        if t2 != t: open(path, "w").write(t2)
    except Exception: pass

CODE_RE = re.compile(r"(?:\b(?:Board\s+)?Policy\s*(?:No\.?|Number|#)?\s*:?\s*|\bP\s+(?=\d{4}\b))([A-Z]{1,5}(?:-\d{1,4})?(?:\([A-Z]+\))?|\d{1,4}(?:\.\d{1,4})?)\b(?![A-Za-z])")
def policy_code_in(text):
    """The policy's own code when the document names it ('Policy JGA-2', 'Board Policy 09.433', 'P 2670',
    'Policy FO(LOCAL)'), so a pasted policy is recorded with its number. Without it a bans record built
    from an email is unpublishable by design (Pleasant Hill R-III, 2026-10-27)."""
    for m in CODE_RE.finditer((text or "")[:4000]):
        c = m.group(1)
        if c.isdigit() and len(c) == 4 and 1900 <= int(c) <= 2100: continue   # a year, not a code
        if c.isalpha() and len(c) == 1: continue
        return c
    # A heading form: the code on the line of, or just above, the title ('JDA Corporal Punishment JDA',
    # 'STUDENTS 09.433' two lines above 'Corporal Punishment').
    lines = [re.sub(r"[\u200b\u00a0\ufeff]", " ", l) for l in (text or "")[:4000].splitlines()[:60]]
    for l in lines[:8]:   # the Missouri Consultants for Education layout: the code alone on the first line ('S-170-P', Clinton MO)
        m = re.fullmatch(r"\s*([A-Z]-\d{3}-[A-Z])\s*", l)
        if m: return m.group(1)
    m = re.search(r"Descriptor Code:?\s*\n(?:\s*\n)*\s*(\d{1,4}(?:\.\d{1,4})?|[A-Z]{2,5}(?:-\d{1,4})?)\b", "\n".join(lines))   # the TSBA layout (Tennessee)
    if m: return m.group(1)
    for i, l in enumerate(lines):
        if l.startswith("Policy text as sent by email"): continue   # the filing header carries a timezone like -0500
        if re.search(r"RSMo|§|K\.S\.A|Ark\. Code|Code Ann|Stat\.|Section \d|U\.S\.C", l): continue   # a statute citation is not a policy code
        if not any(re.search(r"corporal punishment", x, re.I) for x in lines[i:i + 3]): continue
        for m in re.finditer(r"(?<![A-Za-z0-9+-])([A-Z]{2,5}(?:-\d{1,4})?|\d{1,4}\.\d{1,4}|\d{4})(?![A-Za-z0-9])", l):
            c = m.group(1)
            if c in HEADING_NOISE or (c.isdigit() and len(c) == 4 and 1900 <= int(c) <= 2100): continue
            if c.isalpha() and (len(c) > 4 or not re.search(r"corporal punishment", l, re.I)): continue   # a bare acronym counts only on the title line itself ('JDA Corporal Punishment'), and letter codes run two to four letters
            return c
    return None
STATES_2 = {"AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"}
HEADING_NOISE = STATES_2 | {"DHS", "DCS", "CPS", "OSSB", "BIP", "LEA", "IDEA", "URL", "BOE", "BOEP", "DESE", "SY", "JV", "CEO", "CFO", "COO", "HR", "IT", "FYI", "ASAP", "LLC", "INC", "ADA", "IEP", "FERPA", "FOIA", "DOE", "SB", "HB", "RSMO", "KSA", "AND", "THE", "FOR", "OUR", "NOT", "OF", "TO", "IN", "BY", "ON", "ANY", "ALL", "NO", "IS", "BE", "OR", "AS", "AT", "WILL", "SHALL", "MAY", "MUST", "USE", "USD", "ISD", "CPS", "PDF", "FAX", "EXT", "RE", "FW", "FWD", "AM", "PM", "EDT", "CDT", "EST", "CST", "MST", "PST", "MDT", "PDT", "II", "III", "IV", "VI", "VII", "VIII", "USA", "FROM", "SENT", "DATE", "EMAIL"}

RULE_RE = re.compile(r"\b(shall|must|may not|will not|prohibit(s|ed)?|permitted|authoriz(es|ed)|the policy (does not|prohibits|allows|permits|states)|policy\s+[A-Z]{0,4}-?\d+)\b", re.I)
FIRST_PERSON_RE = re.compile(r"\b(we|our|us|I|I'm|I've|my|me)\b")
def code_in_name(fn):
    """The policy code when the district put it in the file's name and the document does not print it
    ('fob-corporal-punishment.doc' from Yale OK, 'Policy_FOB_-_Corporal_Punishment.pdf', 'S-170-P.pdf').
    Capitals beside the word policy, or any two to four letters right before the word corporal."""
    base = re.sub(r"^[0-9A-Za-z]+?-(?=\D)", "", os.path.basename(fn), count=1) if re.match(r"^\d{7}-", os.path.basename(fn)) else os.path.basename(fn)
    m = re.match(r"([A-Z]-\d{3}-[A-Z])\.", base)
    if m: return m.group(1)
    t = [x for x in re.split(r"[^A-Za-z0-9]+", os.path.splitext(base)[0]) if x]
    for i, x in enumerate(t):
        if not re.fullmatch(r"[A-Za-z]{2,4}", x) or x.upper() in HEADING_NOISE or x.lower() in ("new", "old", "copy", "the", "our", "pdf", "doc", "rev", "form"): continue
        if i + 1 < len(t) and t[i + 1].lower() == "corporal": return x.upper()
        if x.isupper() and ((i and t[i - 1].lower() == "policy") or (i + 1 < len(t) and t[i + 1].lower() == "policy")): return x
    return None
def ocr_text(path):
    """What a picture says, by tesseract; empty when the tool is missing or the picture has no words."""
    try:
        out = subprocess.run(["tesseract", path, "-", "--psm", "6"], capture_output=True, text=True, timeout=120).stdout
    except Exception as ex:
        log("ocr failed", os.path.basename(path), repr(ex)[:80]); return ""
    return out if len(re.findall(r"[A-Za-z]{3,}", out)) >= 20 else ""
def policy_like(text):
    """True when pasted email text reads like a policy (a rule's verb or a policy code, not written in the first
    person), false when it is the superintendent's own word: "we do not use it" is a claim, never a policy.
    Milan IN, 2026-10-27: one such sentence was filed as a prohibition and a certificate quoted it the same hour."""
    t = triage_mod.strip_quoted(text or "")
    for s in re.split(r"(?<=[.!?\"])\s+|\n{2,}", t):
        if re.search(r"corporal punishment", s, re.I) and RULE_RE.search(s) and not FIRST_PERSON_RE.search(s):
            return True
    return False
FILING = []          # what became of each document in the reply being handled; handle_one hands it to the writer
WHY_NOT = [None]     # why the last document was not recorded
NOT_RECORDED = {"held": "it mentions corporal punishment but the reader was not sure what the rule is; NOT recorded",
                "unreadable": "no usable text came out of the file; NOT read, NOT recorded",
                "nothing": "read in full; no sentence about corporal punishment in it; nothing recorded from it",
                "nothing_at_link": "the link opened, but the page we got has no sentence about corporal punishment (a policy portal often shows its text only in a browser); NOT recorded",
                "unopened": "the link could not be opened; NOT read, NOT recorded"}
def file_document(r, path, how):
    """Clip -> Jev classify -> record -> merge -> publish. Returns the status recorded, "held", or None.
    Whatever happens is also noted in FILING, because None used to mean four different things and the
    writer was told none of them."""
    WHY_NOT[0] = None
    got = _file_document(r, path, how)
    kind = "link" if how.startswith("link in") else "page" if how.startswith("re-checked") else "pasted" if how.startswith("pasted") else "attached"
    what = how.split(": ", 1)[1] if kind in ("link", "page") and ": " in how else re.sub(r"^[0-9A-Za-z]+-(screenshot-\d+-)?", "", os.path.basename(path))
    FILING.append({"what": what, "kind": kind, "outcome": got or WHY_NOT[0] or "nothing"})
    return got
def _file_document(r, path, how):
    scrub(path)
    text = doc_text(path); cands = clip(text)
    if how.startswith("pasted into") and (not policy_like(text) or not policy_code_in(text)):   # a pasted policy without its code is unpublishable as bans (validate.mjs); kept as the district's word until the code or a link arrives (Millington TN blocked every publish for two days)
        # Their word, not their policy: the thread keeps it (the writer reads it), the record does not.
        log("email is a statement, not policy text; not filed:", r["name"], (cands[0][:80] if cands else ""))
        try: os.remove(path)
        except OSError: pass
        r["district_says"] = (cands[0].strip()[:300] if cands else None); r["district_says_on"] = datetime.date.today().isoformat()
        WHY_NOT[0] = "statement"; return None
    rel = os.path.relpath(path, ROOT); url = RAW + rel
    # A page we found by searching is not a page the district sent. It has to prove whose it is, its
    # sentences have to be rules and not menus or news, and the record says where it was found. On
    # 2026-11-10 and 11 a search relay returned pages from other websites and 74 of them were filed here
    # as answers to records requests; five certificates went out on them.
    found = how.split(": ", 1)[1] if how.startswith("re-checked") and ": " in how else None
    if found:
        import evidence
        dom = recheck_mod.domain_of(r.get("answered_from") or r.get("to")) or recheck_mod.domain_of(r.get("website"))
        why = None if evidence.own_host(found, dom) else f"{evidence.host_of(found)} is not the district's own site"
        why = why or evidence.document_problem(text, r["name"], r["state"])
        if why:
            log("re-check: not filed,", r["name"], "|", why, "|", found[:100])
            try: os.remove(path)
            except OSError: pass
            WHY_NOT[0] = "not_theirs"; return None
        cands = [c for c in cands if not evidence.quote_problem(c, r["state"], r["name"])]
    if not cands:
        # A web page with no rule on it is an index we could not get past; a file we could not read is
        # unreadable; a file read in full that never mentions it is silent, and that is an answer.
        WHY_NOT[0] = "nothing_at_link" if how.startswith("link in") and path.lower().endswith((".html", ".htm")) else \
                     "unreadable" if len(text.strip()) < 200 or (path.lower().endswith(".pdf") and layer_problem(text)) else "nothing"
        log("document silent on corporal punishment:" if WHY_NOT[0] == "nothing" else f"nothing read from the document ({WHY_NOT[0]}):", rel); return None
    title = f"document found on the district's own website ({found})" if found else f"document received by records request ({how})"
    row = {"site": None, "district": r["name"], "_state": r["state"], "verdict": "rule", "policies": [{"code": policy_code_in(text) or (code_in_name(path) if not how.startswith(("link in", "re-checked", "pasted")) else None), "title": title, "url": url, "candidates": cands[:40], "last_revised": None}]}
    tmp = os.path.join(LOGDIR, f"inbound-{r['id']}.jsonl"); open(tmp, "w").write(json.dumps(row) + "\n")
    cls = os.path.join(LOGDIR, f"inbound-{r['id']}-classified.json"); rec = os.path.join(LOGDIR, f"inbound-{r['id']}-records.json")
    env = dict(os.environ, OPENROUTER_API_KEY=jev_key())
    subprocess.run(["node", "tools/tasb/classify.mjs", "--in", tmp, "--out", cls], cwd=ROOT, env=env, capture_output=True)
    if found:   # whose page it is was proven above; the record step refuses a searched document without this stamp
        try:
            rows = json.load(open(cls))
            for x in rows: x["identity"] = {"ok": True, "how": f"on the district's own website ({evidence.host_of(found)}), and the page names the district"}
            json.dump(rows, open(cls, "w"), indent=1)
        except Exception as ex: log("re-check: could not stamp whose document it is:", repr(ex)[:100])
    today = datetime.date.today().isoformat()
    method, note = ("searched_document", f"Found on the district's own website at {found} on {today}, after the district said its policy is published there; a copy is kept in the repository at {rel}.") if found else \
                   ("records_request", f"Received from the district by email in answer to a public records request, {today}; the document is kept in the repository at {rel}.")
    out = subprocess.run(["python3", "tools/tasb/records-from-classified.py", cls, rec, method, "", note], cwd=ROOT, capture_output=True, text=True)
    recs = json.load(open(rec)) if os.path.exists(rec) else []
    for x in recs:
        if not x.get("nces_id") and r.get("nces_id"): x["nces_id"] = r["nces_id"]
    json.dump(recs, open(rec, "w"), indent=1)
    if not recs:
        log("held for review (below threshold):", rel); return "held"
    if recs[0].get("status") == "bans" and not recs[0].get("policy_code"):
        log("held for review (a prohibition with no policy code cannot be published):", rel, "|", (recs[0].get("quote") or "")[:120]); return "held"
    if os.environ.get("ESCP_DRY"):   # a rehearsal: everything up to the record, nothing merged or published
        log("dry: would record", r["state"], r["name"], recs[0].get("status"), recs[0].get("policy_code"), "|", (recs[0].get("quote") or "")[:160]); return recs[0]["status"]
    subprocess.run(["node", "tools/merge-scan.mjs", rec], cwd=ROOT, capture_output=True)
    publish(f"{'Found on the district site' if found else 'Records request answered'}: {nice(r['name'])}, {r['state']}")
    return recs[0]["status"]
def publish(message):
    r = subprocess.run(["bash", "tools/publish.sh", message], cwd=ROOT, capture_output=True, text=True); log(r.stdout.strip()[-300:])
SENT_SCANNED = os.path.join(ROOT, "data/outreach/sent-scanned.json")
def anthony_threads(M, reqs):
    """Anthony's own replies from Sent Mail, folded into each request's our_messages (by: anthony) so the
    writer reads them as part of the thread. Returns the request ids he has written in. Since 2026-10-09
    his presence is context, not a lock: the job keeps answering unless hold_replies is set on the request.

    Incremental since 2026-10-27: the search matches every sent message in 120 days (2,136 that night) and
    fetching each in full took the inbox step past the 13-minute watchdog twice in a row. Now the headers
    come down in one round trip and only messages never seen before are fetched whole."""
    done = {r["id"] for r in reqs if any(o.get("by") == "anthony" for o in r.get("our_messages") or [])}
    try:
        scanned = set(json.load(open(SENT_SCANNED))) if os.path.exists(SENT_SCANNED) else set()
    except Exception:
        scanned = set()
    known = scanned | {o.get("message_id") for r in reqs for o in r.get("our_messages") or [] if o.get("message_id")}
    try:
        M.select('"[Gmail]/Sent Mail"')
        typ, data = M.search(None, "X-GM-RAW", '"newer_than:120d subject:(corporal OR handbook OR records OR schools)"')
        nums = data[0].split() if data and data[0] else []
        want = []
        for i in range(0, len(nums), 500):   # headers only, a few hundred per round trip
            typ, hdrs = M.fetch(b",".join(nums[i:i + 500]), "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO)])")
            for item in hdrs or []:
                if not isinstance(item, tuple): continue
                num = item[0].split()[0]; h = email.message_from_bytes(item[1]); mid = (h.get("Message-ID") or "").strip()
                if not h.get("In-Reply-To"): continue          # our own outbound requests are not replies
                if not mid or "escp-" in mid or mid in known: continue   # the job's own replies, or already folded in
                want.append((num, mid))
        for num, mid in want:
            if time.time() > CYCLE_DEADLINE - 120: log("sent-mail scan: out of time, the rest next cycle"); break
            typ, raw = M.fetch(num, "(RFC822)"); h = email.message_from_bytes(raw[0][1])
            scanned.add(mid)
            r = find_request(h, reqs)
            if not r:
                to = email.utils.parseaddr(h.get("To", ""))[1].lower(); r = next((x for x in reqs if (x.get("to") or "").lower() == to), None)
            if not r: continue
            done.add(r["id"])
            text, _ = part_text(h)
            # The ledger is a public file. Anthony gave a superintendent his cell number in a reply and it
            # was published with the thread (2026-10); phone numbers in his own mail stay out of it.
            text = re.sub(r"\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b", "[phone number]", text)
            r.setdefault("our_messages", []).append({"at": h.get("Date"), "to": email.utils.parseaddr(h.get("To", ""))[1], "text": text, "message_id": mid, "by": "anthony"})
        if want: log(f"sent-mail scan: {len(want)} new messages of Anthony's read")
        json.dump(sorted(scanned), open(SENT_SCANNED, "w"))
    except Exception as e: log("sent-mail scan failed", repr(e)[:120])
    return done
# Every phrase a subject of ours can carry. The Gmail search below is built from this list, and inbox()
# alerts when a sent subject matches none of them: the 86 board notes of 2026-10-28 ("a four-minute film
# for the board") matched nothing, so three board members' replies sat unread for two weeks.
INBOX_SUBJECT_TERMS = ["corporal", "records request", "relied on", "handbook", "discipline data", "Safe School", "Safe Schools",
                       "film for the board", "reported zero", "repeat emails", "certificate"]
def inbox():
    reqs = load(); M = imap(); ensure_label(M); mine = anthony_threads(M, reqs)
    for r in reqs:
        if r["id"] in mine and r["status"] == "anthony_replied": r["status"] = "sent"   # the old lock, lifted
    save(reqs); M.select('"[Gmail]/All Mail"')   # not INBOX: a reply Anthony archived from his phone is still a reply (Norfork, 2026-10-13)
    # Gmail's own search: only mail that could be a reply to us, instead of walking the whole inbox
    # Every subject we have ever sent, not just the ones with "corporal" in them: the research and
    # agency requests would otherwise never have their replies read.
    deaf = sorted({r["subject"] for r in reqs if r.get("subject") and r["status"] != "pending" and not any(t.lower() in r["subject"].lower() for t in INBOX_SUBJECT_TERMS)})
    if deaf: alert("inbox-deaf", f"ESCP: {len(deaf)} sent subjects are invisible to the inbox search, e.g. '{deaf[0][:50]}'. Add a term to INBOX_SUBJECT_TERMS.")
    typ, data = M.search(None, "X-GM-RAW", '"newer_than:21d -from:me -in:drafts (' + " OR ".join(("subject:" + t) if " " not in t else ('subject:\\"' + t + '\\"') for t in INBOX_SUBJECT_TERMS) + ')"'); seen = {m for r in reqs for m in [x["message_id"] for x in r.get("replies") or []]}
    handled = 0; nums = data[0].split() if data and data[0] else []; t0 = time.time()
    log(f"inbox: {len(nums)} candidate messages in the last 60 days")
    # Gather first, answer second: a district that sent three emails in twenty minutes (Milan IN, 2026-10-27:
    # the link, the directions, the answer) gets ONE reply, to the latest, with the earlier ones filed as
    # context. Twelve threads got two replies a minute apart, the second contradicting the first, before this.
    batch = {}
    for num in nums:
        if time.time() - t0 > 6 * 60 or time.time() > CYCLE_DEADLINE: log(f"inbox: time budget reached while gathering; the rest waits for the next cycle"); break
        # Message-ID first, whole body only for mail we have not handled: All Mail holds every reply ever
        # answered, and fetching each one in full (attachments included) dropped the socket.
        typ, hdr = M.fetch(num, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
        if not hdr or not isinstance(hdr[0], tuple): continue   # expunged between search and fetch
        mid = email.message_from_bytes(hdr[0][1]).get("Message-ID", "").strip()
        if not mid or mid in seen: continue
        typ, raw = M.fetch(num, "(BODY.PEEK[])")
        if not raw or not isinstance(raw[0], tuple): continue
        msg = email.message_from_bytes(raw[0][1])
        r = find_request(msg, reqs)
        if not r: continue
        batch.setdefault(r["id"], []).append((when_ts(msg.get("Date")), r, msg, raw[0][1], mid))
    for rid, items in batch.items():
        if time.time() > CYCLE_DEADLINE: log(f"inbox: time budget reached after {handled} handled; the rest waits for the next cycle"); break
        items.sort(key=lambda x: x[0])
        for i, (_, r, msg, rawbytes, mid) in enumerate(items):
            subject = str(make_header(decode_header(msg.get("Subject", "")))); frm = email.utils.parseaddr(msg.get("From", ""))[1]
            body, atts = part_text(msg); links = [u for u in re.findall(r"https?://[^\s<>\")\]]+", body) if "earthpilot" not in u]
            try:
                handle_one(M, reqs, r, msg, rawbytes, mid, subject, frm, body, atts, links, quiet=False, fold=i < len(items) - 1); handled += 1
                file_away_by_mid(M, mid)   # by Message-ID in INBOX; the loop's sequence numbers belong to All Mail
            except Exception as e:
                log("FAILED on", frm, subject[:50], repr(e)[:200])
    M.logout(); log(f"inbox: {handled} new replies handled")
    # One message, not one per reply. Twenty-eight texts in an afternoon is how a good response rate
    # becomes a burden; the board carries the detail and this carries the headline.
    if handled:
        try:
            import track
            text_anthony(track.digest(load()))
        except Exception as e:
            log("digest failed", repr(e)[:120])
UNFILED_NOTE = ("Something they sent with this message has NOT been read into the record. DOCUMENTS THIS THREAD PRODUCED says what became of each item. "
                "The RECORD NOW line is what the record held before this message, not what their document says. Do not say or imply that the record was updated, "
                "that their policy is now on the record, or what their document says, prohibits or permits. Do not choose thank_recorded. Do not ask them to send it "
                "again, do not ask for a link, and do not file a formal request: they answered. Choose answer: thank them, say it arrived, and say it will be read "
                "and the record updated from it. If a link could not be opened or showed no policy text, you may say that in one plain sentence. Ask for nothing.")
SAYS_RECORDED = re.compile(r"\b(record (now )?(shows|reads|says|lists|reflects|has)|(is|are|it'?s|been|was) (now )?(recorded|on (the|our) record|listed|added|posted)|"
                           r"(I'?ve|I have|we'?ve|we have|I|we) (now |just |already )?(recorded|updated|added|listed|posted|marked|corrected)|now on (the|our) record)\b", re.I)
HARD_BLOCK = re.compile(r"attorney|lawyer|legal action|cease|desist|stop (contacting|emailing|writing)|do not contact|harass|complaint against|report you|unsubscribe", re.I)
NOTE_MARKS = re.compile(r"\[(HELD|DRAFT)[^\]]*\]|They wrote:|^WHY:|^MOVE:", re.M)
def reply_to(r, frm, mid, subject, text, to=None, attachments=None):
    """One reply on an existing thread. Returns True if it went. A body carrying a reviewer's note never goes.
    attachments: repo-relative or absolute paths of PDFs to attach (the district's kit, when they ask for it)."""
    if NOTE_MARKS.search(text or ""):
        log("REFUSED to send: the text carries a reviewer note", r["name"]); return False
    m = EmailMessage(); m["From"] = FROM; m["To"] = to or frm
    subject = " ".join(str(subject).split())   # a folded subject line carries a newline, which a header may not
    m["Subject"] = subject if subject.lower().startswith("re:") else "Re: " + subject
    if not to: m["In-Reply-To"] = mid; m["References"] = mid
    m["Message-ID"] = f"<escp-reply-{hashlib.sha1((r['id'] + mid + text[:40]).encode()).hexdigest()[:12]}@earthpilot.org>"
    m.set_content(text)
    for att in attachments or []:
        pth = att if os.path.isabs(att) else os.path.join(ROOT, att)
        m.add_attachment(open(pth, "rb").read(), maintype="application", subtype="pdf" if pth.endswith(".pdf") else "octet-stream", filename=os.path.basename(pth))
    try:
        smtp_send(m)
        r.setdefault("our_messages", []).append({"at": datetime.datetime.now().isoformat(timespec="seconds"), "to": to or frm, "text": text, **({"attachments": [os.path.basename(a) for a in attachments]} if attachments else {})})
        return True
    except Exception as ex:
        log("reply failed", r["name"], repr(ex)[:140]); return False

def save_docs(r, atts, links, facts):
    """Every document in this reply, filed through the same pipeline as anything else.

    A link in a reply is rarely the file. It is a Drive viewer, a BoardOnTrack landing page, or the
    district's "board policies" index with sixty policies on it. So each link is expanded to its direct
    form, fetched, and — if what comes back is a page rather than a document — read for the one or two
    links on it that look like the policy, which are then fetched too. One hop, never a crawl.
    """
    got = []
    dd = os.path.join(INBOUND, r["state"]); os.makedirs(dd, exist_ok=True)
    tag = lambda u: f"{r.get('nces_id') or r['id']}-link-{hashlib.sha1(u.encode()).hexdigest()[:6]}"
    for i, (fn, payload, ct) in enumerate(atts):
        if re.search(r"\.(pdf|docx?|txt)$", fn, re.I) and payload:
            p = os.path.join(dd, f"{r.get('nces_id') or r['id']}-{re.sub(r'[^A-Za-z0-9._-]', '_', fn)}")
            open(p, "wb").write(payload); got.append(file_document(r, p, "attached to the district's reply"))
        elif (ct.startswith("image/") or re.search(r"\.(png|jpe?g|tiff?|bmp|webp)$", fn, re.I)) and len(payload) >= 20000:
            # A screenshot of the policy (Erlanger-Elsmere KY sent 09.433 as a picture, 2026-10-28, and we
            # answered that we cannot quote a picture). Signature icons are under 20 KB and are skipped.
            p = os.path.join(dd, f"{r.get('nces_id') or r['id']}-screenshot-{i + 1}-{re.sub(r'[^A-Za-z0-9._-]', '_', fn)}")
            open(p, "wb").write(payload); text = ocr_text(p)
            if text and policy_like(text) and policy_code_in(text):
                open(p + ".txt", "w").write(text); got.append(file_document(r, p + ".txt", "screenshot attached to the district's reply, read by OCR; the picture is kept beside the text"))
            else:
                log("screenshot is not a policy page:", r["name"], fn, (re.sub(r"\s+", " ", text)[:80] if text else "(no text)"))
                try: os.remove(p)
                except OSError: pass
    queue = list(dict.fromkeys((facts.get("document_links") or []) + links))[:4]
    hopped = 0
    while queue:
        u = queue.pop(0); opened = False
        for variant in recheck_mod.expand(u):
            ext = ".pdf" if re.search(r"\.pdf|format=pdf", variant, re.I) else ".txt" if "format=txt" in variant else ".html"
            p = os.path.join(dd, tag(variant) + ext)
            if not recheck_mod.fetch(variant, p):
                continue
            opened = True
            head = open(p, "rb").read(5)
            if head[:5] != b"%PDF-" and ext == ".pdf":
                ext = ".html"
            if head[:5] == b"%PDF-" and not p.endswith(".pdf"):
                os.rename(p, p[:-len(ext)] + ".pdf"); p = p[:-len(ext)] + ".pdf"; ext = ".pdf"
            try:
                status = file_document(r, p, "link in the district's reply: " + u)
            except Exception as ex:
                log("could not file", variant, repr(ex)[:100]); status = None
            if status and status != "held":
                got.append(status); queue = []; break
            # A page, not a document: take the one or two links on it that look like the policy.
            if hopped < 2 and head[:5] != b"%PDF-":
                inner = recheck_mod.links_inside(p, variant) or recheck_mod.gdoc_links(variant, p)
                if inner:
                    hopped += 1; queue = inner[:3] + queue
            break
        if not opened: FILING.append({"what": u, "kind": "link", "outcome": "unopened"})
    return [g for g in got if g]

_LEA = {}
def website_of(r):
    """The district's website from the federal directory, by id."""
    global _LEA
    if not _LEA:
        try:
            for line in open(os.path.join(ROOT, "data/nces/lea-directory-2023-24.csv")).read().split("\n")[1:]:
                c = line.split(",")
                if len(c) > 5: _LEA[c[0]] = c[4]
        except Exception: pass
    return _LEA.get(str(r.get("nces_id") or ""), "")

FIRST_PERSON_QUOTE = re.compile(r"\b(we|our|us|I|I'm|I've|my|me|Anthony|Mr\.? Adams)\b")
def sane_record(x):
    """The invariant behind every 'the board prohibits it': a bans record built from an email needs a policy code,
    and its quote must not be somebody's sentence to us. A record that fails is read as silent with the sentence
    kept as the district's word, so no reply and no certificate can repeat the Milan mistake even if a bad
    record slips into the file. validate.mjs enforces the same rule at publish time."""
    if x.get("status") != "bans": return x
    emailed = "-email-" in str(x.get("source") or "")
    bad = not x.get("quote") or (emailed and (not x.get("policy_code") or FIRST_PERSON_QUOTE.search(x.get("quote") or "")))
    if not bad: return x
    y = dict(x); y["status"] = "silent"; y["district_says"] = y.get("district_says") or x.get("quote"); y["quote"] = None; y["policy_code"] = None
    log("record read as silent (bans without a policy behind it):", x.get("name")); return y

_DISTRICTS = {}
def state_records(state):
    """One state's records by nces_id, parsed again only when the file changes. The plain loader took 0.6 s
    a call on Missouri, and every reply, desk pass and refile asks once per thread."""
    import yaml
    path = os.path.join(ROOT, "data/districts", f"{state}.yaml"); stamp = os.path.getmtime(path)
    hit = _DISTRICTS.get(state)
    if not hit or hit[0] != stamp:
        d = yaml.load(open(path), Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader)); by = {}
        for x in (d if isinstance(d, list) else d.get("districts", [])):
            if x.get("nces_id"): by.setdefault(str(x["nces_id"]), x)
        hit = _DISTRICTS[state] = (stamp, by)
    return hit[1]

def record_status(r):
    """What the record says for this district right now (after any merge), with its source and code."""
    try:
        x = state_records(r["state"]).get(str(r.get("nces_id") or "")) if r.get("nces_id") else None
        if x: return sane_record(dict(x))
    except FileNotFoundError:
        pass   # a request to a state office or a researcher has no district file behind it
    except Exception as ex:
        log("record_status failed", repr(ex)[:80])
    return {}

def asks_us_back(body):
    """A reply that is a question to us ('are you saying...?') rather than an answer."""
    t = triage_mod.strip_quoted(body)
    return bool(re.search(r"\?\s*$", t.strip()) or re.search(r"\b(are you saying|what do you mean|why (do|did|are) you|can you (explain|clarify)|please (explain|clarify)|contradict)", t, re.I))

def thread_of(r, reqs=None):
    """Every message in this thread, ours and theirs, oldest first: what the model reads before it writes.
    Includes what we sent the same district on sibling requests (a certificate, a correction, an apology),
    because the superintendent sees one conversation; the writer answered Pat's "why do you want this" on
    2026-10-27 by re-correcting a mistake the correction email had already owned up to, two hours earlier."""
    msgs = []
    for s in (reqs if reqs is not None else load()):
        if s is r or s.get("id") == r.get("id") or not s.get("sent_at") or s.get("kind") not in ("certificate", "certificate_correction", "certificate_reissue", "retraction", "apology"): continue
        if (r.get("nces_id") and str(s.get("nces_id")) == str(r["nces_id"])) or ((s.get("to") or "").lower() == (r.get("to") or "").lower() and r.get("to")):
            msgs.append({"who": "us", "date": s["sent_at"], "text": f"[{s['kind'].replace('_', ' ')}, sent on its own thread]\n" + (s.get("body") or f"(the {s['kind']} email)"), "links": []})
    first = r.get("body") or body_for(r)   # older requests did not keep their text; the template is what was sent
    msgs.append({"who": "us", "date": r.get("sent_at"), "text": first, "links": []})
    for e in r.get("replies") or []:
        if e.get("from") == "us":
            msgs.append({"who": "us", "date": e.get("date"), "text": e.get("text") or e.get("our_reply") or e.get("action") or "", "links": []}); continue
        path = os.path.join(REPLIES, r["id"], e.get("file") or "")
        text = ""
        if e.get("file") and os.path.exists(path):
            try:
                m = email.message_from_bytes(open(path, "rb").read()); text = triage_mod.strip_quoted(part_text(m)[0])
            except Exception as ex:
                log("thread_of could not read", path, repr(ex)[:80])
        msgs.append({"who": "them", "date": e.get("date"), "text": text, "links": e.get("links") or [], "attachments": e.get("attachments") or [], "kind": e.get("kind")})
        if e.get("our_reply"):
            msgs.append({"who": "us", "date": e.get("date"), "text": e["our_reply"], "links": []})
    seen = {m["text"].strip() for m in msgs if m["who"] == "us"}
    for o in r.get("our_messages") or []:   # reply_to logs here too; the same text must not read as a second send
        if (o.get("text") or "").strip() in seen: continue
        msgs.append({"who": "Anthony himself" if o.get("by") == "anthony" else "us", "date": o.get("at"), "text": o.get("text") or "", "links": []})
    def when(m):
        d = m.get("date")
        try:
            return email.utils.parsedate_to_datetime(d).timestamp() if d and "," in str(d) else datetime.datetime.fromisoformat(str(d)[:19]).timestamp()
        except Exception:
            return 0
    # stable: keep insertion order where dates tie or are missing
    return [m for _, _, m in sorted((when(m), i, m) for i, m in enumerate(msgs))]


def handle_one(M, reqs, r, msg, rawbytes, mid, subject, frm, body, atts, links, quiet=False, fold=False):
    """One reply: filed, read in the context of the whole thread, then answered or held.

    Code does what code is certain of: the ledger of what has been answered, bounces, filing every document
    and link through the same pipeline as everything else (a board policy outranks a handbook in the merge),
    the re-check of their website, the facts that regexes can extract. A frontier model then reads the entire
    thread plus the record and chooses one move and writes the reply; Jev referees it; code enforces the two
    limits the model is not trusted with. Strafford R-VI, 2026-10-05, is why: a superintendent sent his
    handbook, got told "the board permits it" against his own policy, said "we do not allow it", and got a
    records request. Each reply had been read on its own.
    """
    if mid in (r.get("answered_message_ids") or []):
        log("already answered", r["state"], r["name"], mid[:40]); return
    if r.get("kind") == "board_note" and not r.get("hold_replies"):
        # A board member is an elected official answering a personal note, and the triage and the writer
        # are built for records-request replies. These are filed and handed to Anthony, never auto-answered.
        r["hold_replies"] = True
        alert("board-reply-" + r["id"], f"ESCP: a board member replied ({nice(r['name'])}, {frm}). Filed and left for you; nothing was sent back.")
    quiet = quiet or bool(r.get("hold_replies"))   # a thread Anthony has taken over by hand
    d = os.path.join(REPLIES, r["id"]); os.makedirs(d, exist_ok=True); h = hashlib.sha1(mid.encode()).hexdigest()[:8]
    open(os.path.join(d, h + ".eml"), "wb").write(rawbytes)
    kind, conf, facts = triage_mod.triage(subject, frm, body, [a[0] for a in atts], links)
    entry = {"message_id": mid, "from": frm, "date": msg.get("Date"), "kind": kind, "confidence": conf,
             "facts": facts, "attachments": [a[0] for a in atts], "links": links[:10], "file": h + ".eml", "action": None}
    log(f"reply from {frm} for {r['state']} {r['name']}: {kind} ({conf})")
    r["answered_from"] = frm
    r["last_reply_at"] = datetime.datetime.now().isoformat(timespec="seconds")
    if facts.get("residency_required"):
        r["residency_required"] = True
        if facts.get("residency_proof_accepted"): r["residency_proof_accepted"] = facts["residency_proof_accepted"]
    if facts.get("redirect_to"): r["redirect_to"] = facts["redirect_to"]
    r.setdefault("replies", []); r.setdefault("answered_message_ids", [])

    def finish():
        r["answered_message_ids"].append(mid); r["replies"].append(entry); save(reqs)

    # A thread waiting on one specific answer: will the district mail or email, or is it pickup only? The
    # expanded request goes the moment pickup-only is confirmed, and is dropped if copies are coming.
    if r.get("pending_expanded") and kind != "auto_reply_or_bounce":
        try:
            a = triage_mod.jev({"their_reply": triage_mod.strip_quoted(body)[:1500]}, {"pickup_only": {"type": "noul", "instructions": "Does this reply say the documents will be available ONLY by in-person pickup at the office, declining to mail or email them?", "criteria": {"true": "Pickup only; no mailing or emailing.", "false": "They will mail or email, or the reply is about something else."}},
                                                                                        "will_send": {"type": "noul", "instructions": "Does this reply agree to mail or email the documents (possibly for a fee)?", "criteria": {"true": "They will mail or email them.", "false": "They do not."}}})
            pickup = float(a["pickup_only"].get("noul") or 0); will = float(a["will_send"].get("noul") or 0)
        except Exception:
            pickup = will = 0
        if pickup >= 0.7 and will < 0.5:
            text = messages.expanded_pickup(r, USER, r.get("statute") or "your state's public records law")
            if reply_to(r, frm, mid, subject, text):
                entry["action"] = "pickup-only confirmed; the expanded request went"; entry["our_reply"] = text; r["expanded_requested_at"] = datetime.date.today().isoformat(); r.pop("pending_expanded", None); r["status"] = "sent"
                r["answered_message_ids"].append(mid); r["replies"].append(entry); save(reqs); return
        elif will >= 0.7:
            entry["action"] = "they will send copies; the expanded request is not needed"; r.pop("pending_expanded", None)
    if kind == "auto_reply_or_bounce":
        if re.search(r"delivery|undeliver|failure|not delivered|couldn't be found|address not found|wasn't delivered|could not be delivered|does not exist|no such user|user unknown|rejected|mailbox (is )?(full|unavailable)", subject + body[:900], re.I):
            r["status"] = "bounced"
        entry["action"] = "logged"; finish(); return

    # 1. Everything the reply carries, filed. The merge decides what the record says afterwards.
    # Policy text pasted straight into the email (Anderson County KY pasted 09.433 in full) is a document:
    # the email itself is kept in the repository as the source.
    filed = []; del FILING[:]
    pasted = [x for x in clip(triage_mod.strip_quoted(body)) if len(x) > 40]
    if pasted and not atts:
        try:
            dd = os.path.join(INBOUND, r["state"]); os.makedirs(dd, exist_ok=True)
            pth = os.path.join(dd, f"{r.get('nces_id') or r['id']}-email-{h}.txt")
            open(pth, "w").write(f"Policy text as sent by email from {frm} on {msg.get('Date')}:\n\n{triage_mod.strip_quoted(body)}\n")
            got = file_document(r, pth, f"pasted into the district's email reply of {str(msg.get('Date'))[:16]}")
            if got: filed.append(got)
        except Exception as ex:
            log("pasted text could not be filed", r["name"], repr(ex)[:100])
    if atts or links:
        try:
            got = save_docs(r, atts, links, facts)
        except Exception as ex:
            log("save_docs failed", r["name"], repr(ex)[:120]); got = []
        filed = [g for g in got if g]
        if "held" in filed: entry["held_documents"] = True
    # 1b. Directions in prose ("Section 4 on the Diligent site"): find what they pointed at and read it.
    if not [f for f in filed if f != "held"] and not atts:
        site = website_of(r)
        urls = writer_mod.leads(r, triage_mod.strip_quoted(body), site)
        if urls:
            log("following their directions:", r["name"], urls[:3])
            try:
                got = save_docs(r, [], urls, {"document_links": urls})
                filed += [g for g in got if g]; entry["directions_followed"] = urls
            except Exception as ex:
                log("directions fetch failed", r["name"], repr(ex)[:100])
    # 2. "It's on our website": look before asking.
    recheck = None
    if kind == "website_no_link" and not filed:
        looked_ok = True
        try:
            status, tried = recheck_mod.recheck(r, file_document, log=log)
        except recheck_mod.SearchDown as ex:
            # Could not search is not "searched and found nothing": the writer must not tell a
            # superintendent we looked at a site we never reached.
            log("recheck: search is down, not run for", r["name"], str(ex)[:100]); status, tried, looked_ok = None, [], False
            alert("search-down", f"ESCP: web search is down ({str(ex)[:70]}). Re-checks are skipped until it is back.")
        except Exception as ex:
            log("recheck failed", r["name"], repr(ex)[:140]); status, tried, looked_ok = None, [], False
        if looked_ok:
            r["rechecked_at"] = datetime.datetime.now().isoformat(timespec="seconds"); r["recheck_tried"] = tried[:6]
            recheck = {"found": status, "looked_at": tried[:6]}
        if status and status != "held": filed.append(status)
    record = record_status(r)
    recorded = [g for g in filed if g != "held"]
    if recorded:
        r["recorded_status"] = record.get("status") or recorded[0]
        entry["action"] = f"recorded {r['recorded_status']}" + (f" (document said {recorded[0]}; board policy governs)" if record.get("status") and record["status"] != recorded[0] else "")
    if facts.get("claims_no_practice"): r["claims_no_practice"] = True
    # What they sent, and what became of each item: an attachment, a link the triage read as the document,
    # or anything that was recorded. A signature link that led nowhere is not a document and is left out.
    sent_us = [f for f in FILING if f["outcome"] not in ("statement", "not_theirs")
               and (f["kind"] in ("attached", "pasted") or f["what"] in (facts.get("document_links") or []) or f["outcome"] not in NOT_RECORDED)]
    if recorded: sent_us = [f for f in sent_us if f["outcome"] != "nothing_at_link"]   # the index page that led to the policy
    unfiled = [f for f in sent_us if f["outcome"] in ("held", "unreadable", "unopened", "nothing_at_link")] if not recorded else []
    desk_note = None
    if unfiled:
        r["unfiled_since"] = r.get("unfiled_since") or datetime.date.today().isoformat()
        entry["unfiled"] = [{"what": f["what"][:200], "outcome": f["outcome"]} for f in unfiled[:6]]
        desk_note = UNFILED_NOTE
        log("arrived and not recorded:", r["state"], r["name"], "|", "; ".join(f"{f['what'][:60]} ({f['outcome']})" for f in unfiled[:4]))
    elif recorded: r.pop("unfiled_since", None)
    if fold:
        entry["action"] = (entry.get("action") or "") + "; filed, answered with their later message in the same batch"; entry["move"] = "fold"
        log("folded", r["state"], r["name"], mid[:40]); finish(); return

    # 3. The whole thread, read by the writer. Then one move.
    thread = thread_of(r, reqs) + [{"who": "them", "date": msg.get("Date"), "text": triage_mod.strip_quoted(body), "links": links[:10], "attachments": [a[0] for a in atts], "kind": kind}]
    filed_desc = [{"what": f["what"], "says": NOT_RECORDED.get(f["outcome"], f["outcome"])} for f in sent_us] or ([{"says": f} for f in filed] if filed else [])
    decision = writer_mod.decide(r, thread, record, filed_desc, facts, recheck, quiet, note=desk_note)
    decision = writer_mod.unstock(decision, r, thread, record, filed_desc, facts, recheck, quiet, note=desk_note)   # one redraft if it opened with a stock line
    move = decision["move"] if decision else "hold"
    text = decision["reply"] if decision else None
    why = decision["why"] if decision else f"the writer returned nothing usable ({writer_mod.LAST_ERROR[0]})"
    their_replies = sum(1 for m in thread if m["who"] == "them")
    # The limits code keeps whatever the model chose.
    if move == "ask_minutes" and (record.get("status") == "bans" or their_replies > 1 or r.get("residency_required")):
        move, why = "hold", f"minutes request blocked by rule ({'policy already prohibits' if record.get('status') == 'bans' else 'not a first reply' if their_replies > 1 else 'needs a resident'}); {why}"
    if move == "invite_policy" and (record.get("status") == "bans" or r.get("invited_policy_at")):
        move, why = "hold", f"invitation blocked by rule ({'policy already prohibits' if record.get('status') == 'bans' else 'already invited on ' + r['invited_policy_at']}); {why}"
    if move == "records_request" and r.get("formal_requested_at"):
        move, why = "hold", "a formal request already went out on this thread; " + why
    # "We don't publish that" with the policy attached is an answer, not a refusal. Anything that arrived in
    # this message or earlier in the thread outranks what the words say: no formal request, no ask for a link.
    docs_in_thread = bool(atts) or bool(recorded) or any(e2.get("filed") or e2.get("attachments") for e2 in r.get("replies") or [])
    if move in ("records_request", "ask_link", "ask_minutes") and docs_in_thread:
        move, why = ("thank_recorded" if recorded else "hold"), f"a document is in the thread; {why}"
    if move == "forward" and not facts.get("redirect_to"):
        move, why = "hold", "forward with no address named; " + why
    # Fees: anything above $5 is a person's call. $100 is the whole campaign's budget for copies.
    if move != "hold" and re.search(r"\$\s*(\d[\d,]*(?:\.\d+)?)", triage_mod.strip_quoted(body)):
        amts = [float(a.replace(",", "")) for a in re.findall(r"\$\s*(\d[\d,]*(?:\.\d+)?)", triage_mod.strip_quoted(body))]
        if max(amts) > 5:
            move, why = "hold", f"a fee of ${max(amts):g} is quoted; over the $5 line; " + why
    # Nothing was recorded, so nothing is said to have been. Ten superintendents were thanked for a policy
    # "now on the record" between 2026-10-27 and 11-10 while the reader had logged their document as silent.
    if unfiled and move == "thank_recorded":
        move, why = "answer", "their document is not on the record yet, so this is a thank-you and not a confirmation; " + why
    if unfiled and text and move != "hold" and SAYS_RECORDED.search(text):
        again = writer_mod.decide(r, thread, record, filed_desc, facts, recheck, quiet, note=desk_note + " REDRAFT: your last draft said the record was updated. It was not. Take that out.")
        if again and again.get("reply") and not SAYS_RECORDED.search(again["reply"]):
            move, text, why = "answer", again["reply"], "redrafted (the first draft said the record was updated); " + why
        else:
            move, why, text = "hold", "the draft says the record was updated and nothing was recorded; " + why, None
    if quiet:
        move, why = "hold", "Anthony is in this thread; " + why
    # Anthony sends nothing by hand: a hold that still has a usable reply goes out as an answer unless
    # the thread is hard-blocked (threats, complaints, stop-writing, residency, a fee over $5).
    if move == "hold" and text and not quiet and not HARD_BLOCK.search(triage_mod.strip_quoted(body)) and not r.get("residency_required") and not re.search(r"fee|\$\s*\d", why, re.I):
        move, why = "answer", "sent despite the writer's hesitation (Anthony sends nothing by hand); " + why
    ok = bool(text) and move != "hold" and writer_mod.check(text, thread, record)
    if text and move != "hold" and not ok:
        # a thank-you that restates a record just updated from the district's own document is low risk: it sends.
        # money, requests, deadlines or legal steps in the draft still hold for a person.
        low_risk = move in ("thank_recorded", "answer") and bool(recorded) and not re.search(r"\$|\bfee\b|deadline|lawsuit|attorney|\bsue\b|request under|freedom of information|open records|sunshine|deleted|repealed|rescinded", text, re.I)
        if low_risk: ok = True; why = "referee flagged, sent anyway (thank-you on a recorded document); " + why
        else: move, why = "hold", "the referee held it; " + why

    entry["move"] = move; entry["why"] = why
    if move == "forward":
        to = facts["redirect_to"]
        if reply_to(r, frm, mid, messages.nice(r["name"]) + " corporal punishment policy", text, to=to):
            r["to"] = to; r["status"] = "sent"; r["sent_at"] = datetime.datetime.now().isoformat(timespec="seconds"); entry["action"] = f"forwarded to {to}"; entry["our_reply"] = text
        else:
            r["status"] = "needs_review"; entry["action"] = "forward failed to send"
    elif move != "hold":
        if reply_to(r, frm, mid, subject, text):
            entry["our_reply"] = text; entry["action"] = (entry.get("action") or "") + f"; replied ({move})"
            if move == "thank_recorded" or (unfiled and move == "answer"): r["status"] = "answered"   # they answered; reading it is on us (unfiled_since)
            elif move == "ask_link": r["awaiting_link_since"] = datetime.date.today().isoformat(); r["status"] = "sent"
            elif move == "ask_residency_proof": r["residency_asked_at"] = datetime.date.today().isoformat(); r["status"] = "sent"
            elif move == "ask_minutes": r["minutes_requested_at"] = datetime.date.today().isoformat(); r["status"] = "sent"; r["claim"] = "the district does not use corporal punishment"
            elif move == "invite_policy": r["invited_policy_at"] = datetime.date.today().isoformat(); r["status"] = "sent"; r["claim"] = "the district does not use corporal punishment"
            elif move == "records_request": r["formal_requested_at"] = datetime.date.today().isoformat(); r["status"] = "sent"
            else: r["status"] = "sent"
        else:
            r["status"] = "needs_review"; entry["action"] = (entry.get("action") or "") + "; reply failed to send"
    elif not text and re.search(r"acknowledg|no reply needed|nothing to answer|no response needed|pleasantry|courtesy|sign-off|signoff|closing|closes the thread|thread is (settled|complete|closed)|duplicat", why, re.I):
        entry["action"] = (entry.get("action") or "") + f"; logged, no reply needed: {why}"
        r["status"] = r.get("status") if r.get("status") in ("promised", "answered") else "sent"
    else:
        r["status"] = "anthony_replied" if quiet else "needs_review"
        entry["action"] = (entry.get("action") or "") + ("; logged, Anthony is handling this thread" if quiet else f"; held for Anthony: {why}")
        if text: entry["suggested"] = text
        if not quiet:
            m = EmailMessage(); m["From"] = FROM; m["To"] = frm; m["Subject"] = "Re: " + " ".join(str(subject).split())
            m["In-Reply-To"] = mid; m["References"] = mid
            m.set_content(text or "")
            put_draft(M, m)
    finish()


# ---------------------------------------------------------------- the daily queue
def queue(n=25):
    """Put the next n districts on the pending list: no quoted rule yet, in a state that permits the practice,
    with an office address on file, most children struck first. The hourly cycle sends what is pending.
    Nothing is written twice: a district already in the request file is never queued again."""
    import yaml
    states = json.load(open(os.path.join(ROOT, "site/data/states.json")))
    permitting = {k for k, v in states.items() if v.get("status") in ("legal", "partial")}
    reqs = load(); have = {str(r.get("nces_id")) for r in reqs if r.get("nces_id")} | {(r["state"], r["name"].lower()) for r in reqs}
    statutes = {}
    for r in reqs:
        if r.get("statute") and r["state"] not in statutes: statutes[r["state"]] = r["statute"]
    contacts = {}
    for f in os.listdir(os.path.join(ROOT, "data/contacts")):
        if not f.endswith(".json"): continue
        d = json.load(open(os.path.join(ROOT, "data/contacts", f)))
        rows = d if isinstance(d, list) else (d.get("contacts") or d.get("districts") or [])
        for c in rows:
            if isinstance(c, dict) and c.get("state") and c.get("name") and (c.get("district_email") or c.get("email")):
                contacts[(c["state"], re.sub(r"[^a-z0-9]", "", c["name"].lower()))] = c
                if c.get("nces_id"): contacts[("id", str(c["nces_id"]))] = c
    crdc = {}
    for l in open(os.path.join(ROOT, "data/crdc/2023-24/districts.csv")).read().strip().split("\n")[1:]:
        c = l.rsplit(",", 1); crdc[c[0].split(",")[1]] = int(c[1] or 0)
    cands = []
    for st in sorted(permitting):
        fp = os.path.join(ROOT, "data/districts", f"{st}.yaml")
        if not os.path.exists(fp): continue
        d = yaml.safe_load(open(fp))
        for x in (d if isinstance(d, list) else d.get("districts", [])):
            if x.get("quote") or x.get("status") not in ("silent", "unknown"): continue
            if str(x.get("nces_id")) in have or (st, x["name"].lower()) in have: continue
            # The state's own superintendent directory first (23 record contacts were wrong on 2026-10-09:
            # Little Rock carried a charter's address), then whatever the record holds.
            k = contacts.get(("id", str(x.get("nces_id")))) or contacts.get((st, re.sub(r"[^a-z0-9]", "", x["name"].lower()))) or {}
            c = x.get("contact") or {}
            to = k.get("district_email") or k.get("email") or c.get("district_email") or c.get("board_email")
            who = k.get("superintendent") or c.get("superintendent")
            if not to or re.search(r"@(gmail|yahoo|hotmail|aol)\.", to, re.I): continue
            cands.append({"state": st, "name": re.sub(r"\s*\(\d+\)\s*$", "", x["name"]), "nces_id": x.get("nces_id"), "kids": x.get("crdc_students_latest") or crdc.get(str(x.get("nces_id")), 0), "to": to, "superintendent": who})
    cands.sort(key=lambda c: (-(c["kids"] or 0), c["state"], c["name"]))
    added = 0
    for c in cands[:n]:
        rid = hashlib.sha1(f"{c['state']}|{c['nces_id'] or c['name']}".encode()).hexdigest()[:10]
        reqs.append({"id": rid, "state": c["state"], "name": c["name"], "nces_id": c["nces_id"], "kids": c["kids"], "kind": "policy",
                     "to": c["to"], "superintendent": c["superintendent"], "statute": statutes.get(c["state"]),
                     "status": "pending", "sent_at": None, "message_id": None, "replies": [], "followup_sent_at": None,
                     "queued_at": datetime.datetime.now().isoformat(timespec="seconds")})
        if game_assign: game_assign.apply(reqs[-1])   # experiment + variant on the request; an unapproved variant is queued held
        added += 1
    save(reqs); log(f"queue: {added} queued of {len(cands)} eligible ({len(cands) - added} left for later nights)")
    return added


def catchup(send=True):
    """Every thread whose last message from the district has no reply from our side after it (ours or
    Anthony's): file what it carried, decide with the whole thread, send or hold. Skips bounced, closed,
    and hold_replies threads."""
    reqs = load(); M = imap(); anthony_threads(M, reqs); save(reqs)
    def when(d):
        try: return email.utils.parsedate_to_datetime(d).timestamp() if d and "," in str(d) else datetime.datetime.fromisoformat(str(d)[:19]).timestamp()
        except Exception: return 0
    todo = []
    for r in reqs:
        if r.get("status") in ("bounced", "closed") or r.get("hold_replies"): continue
        theirs = [e for e in r.get("replies") or [] if e.get("from") != "us"]
        if not theirs: continue
        last = theirs[-1]
        if last.get("our_reply") or last.get("kind") == "auto_reply_or_bounce": continue
        if any(when(o.get("at")) > when(last.get("date")) for o in r.get("our_messages") or []): continue
        todo.append((r, last))
    log(f"catchup: {len(todo)} threads to answer")
    sent = held = 0
    for r, e in todo:
        path = os.path.join(REPLIES, r["id"], e.get("file") or "")
        if not os.path.exists(path): continue
        msg = email.message_from_bytes(open(path, "rb").read()); body, atts = part_text(msg)
        frm = email.utils.parseaddr(msg.get("From"))[1]; subject = str(make_header(decode_header(msg.get("Subject") or "")))
        filed = []
        pasted = [x for x in clip(triage_mod.strip_quoted(body)) if len(x) > 40]
        if pasted and not atts and not e.get("pasted_filed"):
            try:
                dd = os.path.join(INBOUND, r["state"]); os.makedirs(dd, exist_ok=True)
                pth = os.path.join(dd, f"{r.get('nces_id') or r['id']}-email-{e.get('file','x')[:8]}.txt")
                open(pth, "w").write(f"Policy text as sent by email from {frm} on {msg.get('Date')}:\n\n{triage_mod.strip_quoted(body)}\n")
                got = file_document(r, pth, f"pasted into the district's email reply of {str(msg.get('Date'))[:16]}")
                if got: filed.append(got)
            except Exception as ex:
                log("pasted text could not be filed", r["name"], repr(ex)[:100])
            e["pasted_filed"] = True
        if (e.get("links") or atts) and (not e.get("filed") or e.get("filed") == ["nothing"]):
            try: filed = [g for g in save_docs(r, atts, e.get("links") or [], e.get("facts") or {}) if g]
            except Exception as ex: log("catchup save_docs failed", r["name"], repr(ex)[:100])
            e["filed"] = filed or ["nothing"]
        thread = thread_of(r, reqs); record = record_status(r)
        recorded = [f for f in filed if f != "held"]
        if recorded: r["recorded_status"] = record.get("status") or recorded[0]
        d = writer_mod.decide(r, thread, record, [{"says": f} for f in recorded], e.get("facts") or {}, {"found": None, "looked_at": r.get("recheck_tried") or []} if r.get("rechecked_at") else None, False)
        move = d["move"] if d else "hold"; text = d["reply"] if d else None; why = d["why"] if d else f"writer: {writer_mod.LAST_ERROR[0]}"
        their = len([x for x in thread if x["who"] == "them"])
        if move == "ask_minutes" and (record.get("status") == "bans" or their > 1 or r.get("residency_required")): move = "hold"
        if move == "invite_policy" and (record.get("status") == "bans" or r.get("invited_policy_at")): move = "hold"
        if move in ("forward",): move = "hold"
        if move == "records_request" and (r.get("formal_requested_at") or recorded or atts): move = "hold"
        if move != "hold" and re.search(r"\$\s*(\d[\d,]*(?:\.\d+)?)", triage_mod.strip_quoted(body)) and max(float(a.replace(",", "")) for a in re.findall(r"\$\s*(\d[\d,]*(?:\.\d+)?)", triage_mod.strip_quoted(body))) > 5: move = "hold"
        if move == "hold" and text and not HARD_BLOCK.search(triage_mod.strip_quoted(body)) and not r.get("residency_required") and not re.search(r"fee|\$\s*\d", why, re.I):
            move, why = "answer", "sent despite the writer's hesitation; " + why
        if move == "hold" and text and not HARD_BLOCK.search(triage_mod.strip_quoted(body)) and not r.get("residency_required") and not re.search(r"fee|\$\s*\d", why, re.I):
            move, why = "answer", "sent despite the writer's hesitation; " + why
        ok = bool(text) and move != "hold" and writer_mod.check(text, thread, record)
        if ok and send and reply_to(r, frm, e["message_id"], subject, text):
            e["our_reply"] = text; e["move"] = move; e["why"] = why; e["action"] = (e.get("action") or "") + f"; catch-up reply ({move})"
            if move == "records_request": r["formal_requested_at"] = datetime.date.today().isoformat()
            if move == "invite_policy": r["invited_policy_at"] = datetime.date.today().isoformat()
            r["status"] = "answered" if move == "thank_recorded" else "sent"; sent += 1; log("catchup sent", r["state"], r["name"], move)
        elif not text and re.search(r"acknowledg|no reply needed|nothing to answer", why, re.I):
            e["action"] = (e.get("action") or "") + f"; catch-up: no reply needed ({why[:80]})"
        else:
            e["suggested"] = text; e["why"] = why; e["move"] = "hold"; r["status"] = "needs_review"; held += 1
            if text:
                delete_draft(M, "Re: " + " ".join(subject.split()))
                m = EmailMessage(); m["From"] = FROM; m["To"] = frm; m["Subject"] = "Re: " + " ".join(subject.split()); m["In-Reply-To"] = e["message_id"]; m["References"] = e["message_id"]
                m.set_content(text); put_draft(M, m)
            log("catchup held", r["state"], r["name"], why[:100])
        save(reqs)
    M.logout(); log(f"catchup: {sent} sent, {held} held")


def rehold(send=True, only=None):
    """Threads held for a person: decide again with the whole thread. Sends when the writer picks a move and
    the referee passes; otherwise refreshes the draft with the suggested text. Never touches a thread
    Anthony has written in, and never re-answers a message that already got a reply from us."""
    reqs = load(); M = imap(); mine = anthony_threads(M, reqs); sent = held = 0
    for r in reqs:
        if r.get("status") != "needs_review" or r["id"] in mine or not r.get("replies"): continue
        if only and r["id"] not in only: continue
        e = r["replies"][-1]
        if e.get("from") == "us" or e.get("our_reply") or e.get("move") not in (None, "hold"): continue
        path = os.path.join(REPLIES, r["id"], e.get("file") or "")
        if not os.path.exists(path): continue
        msg = email.message_from_bytes(open(path, "rb").read()); body, atts = part_text(msg)
        frm = email.utils.parseaddr(msg.get("From"))[1]; subject = str(make_header(decode_header(msg.get("Subject") or "")))
        # Links and attachments the first pass did not get through are filed now, so the writer sees what they said.
        filed = []
        pasted = [x for x in clip(triage_mod.strip_quoted(body)) if len(x) > 40]
        if pasted and not atts and not e.get("pasted_filed"):
            try:
                dd = os.path.join(INBOUND, r["state"]); os.makedirs(dd, exist_ok=True)
                pth = os.path.join(dd, f"{r.get('nces_id') or r['id']}-email-{e.get('file','x')[:8]}.txt")
                open(pth, "w").write(f"Policy text as sent by email from {frm} on {msg.get('Date')}:\n\n{triage_mod.strip_quoted(body)}\n")
                got = file_document(r, pth, f"pasted into the district's email reply of {str(msg.get('Date'))[:16]}")
                if got: filed.append(got)
            except Exception as ex:
                log("pasted text could not be filed", r["name"], repr(ex)[:100])
            e["pasted_filed"] = True
        links = e.get("links") or []
        if (links or atts) and (not e.get("filed") or e.get("filed") == ["nothing"]):
            try:
                filed = [g for g in save_docs(r, atts, links, e.get("facts") or {}) if g]
            except Exception as ex:
                log("rehold save_docs failed", r["name"], repr(ex)[:100])
            e["filed"] = filed or ["nothing"]
        thread = thread_of(r, reqs); record = record_status(r)
        filed_desc = [{"says": f} for f in filed if f != "held"]
        d = writer_mod.decide(r, thread, record, filed_desc, e.get("facts") or {}, {"found": None, "looked_at": r.get("recheck_tried") or []} if r.get("rechecked_at") else None, False)
        move = d["move"] if d else "hold"; text = d["reply"] if d else None; why = d["why"] if d else f"writer: {writer_mod.LAST_ERROR[0]}"
        their = sum(1 for m in thread if m["who"] == "them")
        if move == "ask_minutes" and (record.get("status") == "bans" or their > 1 or r.get("residency_required")): move = "hold"
        if move == "invite_policy" and (record.get("status") == "bans" or r.get("invited_policy_at")): move = "hold"
        if move == "forward": move = "hold"
        if move == "records_request" and r.get("formal_requested_at"): move = "hold"
        ok = bool(text) and move != "hold" and writer_mod.check(text, thread, record)
        if ok and send and reply_to(r, frm, e["message_id"], subject, text):
            e["our_reply"] = text; e["move"] = move; e["why"] = why; e["action"] = (e.get("action") or "") + f"; re-decided and replied ({move})"
            if move == "records_request": r["formal_requested_at"] = datetime.date.today().isoformat()
            if move == "invite_policy": r["invited_policy_at"] = datetime.date.today().isoformat()
            r["status"] = "answered" if move == "thank_recorded" else "sent"; sent += 1
            log("rehold sent", r["state"], r["name"], move)
        else:
            e["suggested"] = text; e["why"] = why; held += 1
            if text:
                delete_draft(M, "Re: " + " ".join(subject.split()))
                m = EmailMessage(); m["From"] = FROM; m["To"] = frm; m["Subject"] = "Re: " + " ".join(subject.split()); m["In-Reply-To"] = e["message_id"]; m["References"] = e["message_id"]
                m.set_content(text); put_draft(M, m)
            log("rehold held", r["state"], r["name"], why[:100])
        save(reqs)
    M.logout(); log(f"rehold: {sent} sent, {held} still held")

# ---------------------------------------------------------------- the decisions desk
DECISIONS = os.path.join(ROOT, "data/outreach/decisions.json")
DECISIONS_STATE = os.path.join(ROOT, "data/outreach/decisions-state.json")
DECISIONS_LOG = os.path.join(ROOT, "data/outreach/decisions-log.jsonl")
DECIDE_URL = "https://earthpilot.org/kids/ops/decide.php"
def ops_token():
    p = os.path.expanduser("~/.escp-deploy.env")
    for l in open(p) if os.path.exists(p) else []:
        if l.startswith("OPS_TOKEN="): return l.split("=", 1)[1].strip().strip('"')
    return None

def dlog(**row):
    row["t"] = datetime.datetime.now().isoformat(timespec="seconds")
    open(DECISIONS_LOG, "a").write(json.dumps(row) + "\n"); log("decision", row.get("by"), row.get("action"), row.get("id"), "->", row.get("outcome"))

def apply_decision(did, action, note, by, state):
    """One decision from the desk, Anthony's tap or the clock. Returns a one-line outcome for the log.
    Anthony's approve sends the draft as it stands; the clock's approve has the referee read it again and
    falls back to a redraft (rehold) when the referee declines."""
    reqs = load(); st = state.setdefault(did, {})
    kind, _, rest = did.partition(":")
    if action == "hold":
        st["hold"] = True; st["hold_note"] = note or ""; return "held, no clock"
    if kind == "reply":
        rid = rest.split(":")[0]; r = next((x for x in reqs if x["id"] == rid), None)
        if not r or not r.get("replies"): return "request not found"
        e = r["replies"][-1]
        if r["status"] != "needs_review": return f"already {r['status']}"
        if action in ("drop", "skip"):
            r["status"] = "sent"; e["action"] = (e.get("action") or "") + f"; closed by {by}, no reply"; save(reqs); return "closed, no reply"
        if action == "retry":
            if note: e["redraft_note"] = note; save(reqs)
            rehold(send=True, only={rid}); r2 = next(x for x in load() if x["id"] == rid)
            return "redrafted and sent" if r2["status"] != "needs_review" else "redrafted, still waiting"
        if action == "approve":
            text = e.get("suggested")
            if not text: return "no draft to send"
            if by == "auto" and not writer_mod.check(text, thread_of(r, reqs), record_status(r)):
                st["auto_tried"] = datetime.datetime.now().isoformat(timespec="minutes")
                rehold(send=True, only={rid}); r2 = next(x for x in load() if x["id"] == rid)
                return "referee declined the draft; redrafted and sent" if r2["status"] != "needs_review" else "referee declined the draft; redrafted, waits for Anthony"
            subject = r.get("subject") or ""
            path = os.path.join(REPLIES, rid, e.get("file") or "")
            if e.get("file") and os.path.exists(path):
                try: subject = str(make_header(decode_header(email.message_from_bytes(open(path, "rb").read()).get("Subject") or ""))) or subject
                except Exception: pass
            if reply_to(r, e.get("from"), e.get("message_id"), subject or (messages.nice(r["name"]) + " corporal punishment policy"), text):
                e["our_reply"] = text; e["move"] = e.get("move") if e.get("move") not in (None, "hold") else "answer"; e["action"] = (e.get("action") or "") + f"; approved by {by}, sent"
                r["status"] = "sent"; save(reqs); return "sent"
            return "send failed"
        return f"nothing to do for {action} on a reply"
    if kind == "batch":
        if action == "approve": return f"released {release(rest)}"
        if action == "drop":
            n = 0
            for r in reqs:
                if r.get("kind") == rest and r["status"] == "held": r["status"] = "dropped"; n += 1
            save(reqs); return f"dropped {n}"
        return f"nothing to do for {action} on a batch"
    if kind == "standing":
        if action in ("go", "approve"): st["go"] = datetime.datetime.now().isoformat(timespec="minutes"); st["go_note"] = note or ""; return "go recorded; Claude picks it up"
        if action in ("skip", "drop"): st["skipped"] = datetime.datetime.now().isoformat(timespec="minutes"); return "skipped"
    return f"nothing to do for {action} on {kind}"

def decide():
    """Apply what Anthony tapped on the desk since the last cycle, then whatever has waited past its clock."""
    tok = ops_token(); state = json.load(open(DECISIONS_STATE)) if os.path.exists(DECISIONS_STATE) else {}
    queue = []
    if tok:
        try:
            req = urllib.request.Request(DECIDE_URL + "?token=" + urllib.parse.quote(tok), headers={"User-Agent": "escp-outreach"})
            queue = json.load(urllib.request.urlopen(req, timeout=30))
        except Exception as ex: log("decide: inbox fetch failed", repr(ex)[:80])
    acks = []
    for q in queue:
        try: out = apply_decision(q["id"], q["action"], q.get("note"), "anthony", state)
        except Exception as ex: out = f"failed: {repr(ex)[:80]}"
        dlog(id=q["id"], action=q["action"], by="anthony", outcome=out, note=q.get("note") or ""); acks.append(q["n"])
        json.dump(state, open(DECISIONS_STATE, "w"), indent=1)
    if acks:
        try:
            req = urllib.request.Request(DECIDE_URL, data=json.dumps({"token": tok, "ack": acks}).encode(), headers={"Content-Type": "application/json", "User-Agent": "escp-outreach"})
            urllib.request.urlopen(req, timeout=30).read()
        except Exception as ex: log("decide: ack failed", repr(ex)[:80])
    if os.path.exists(DECISIONS):
        now = datetime.datetime.now().isoformat(timespec="minutes"); n = 0
        for it in json.load(open(DECISIONS)).get("items", []):
            st = state.get(it["id"], {})
            if not it.get("auto_at") or it["auto_at"] > now or st.get("hold") or st.get("auto_tried") or st.get("auto_done"): continue
            if time.time() > CYCLE_DEADLINE - 120: log("decide: out of time, the rest wait a cycle"); break
            try: out = apply_decision(it["id"], "approve", None, "auto", state)
            except Exception as ex: out = f"failed: {repr(ex)[:80]}"
            state.setdefault(it["id"], {})["auto_done"] = now
            dlog(id=it["id"], action="approve", by="auto", outcome=out); n += 1
            json.dump(state, open(DECISIONS_STATE, "w"), indent=1); time.sleep(2)
        if n: log(f"decide: {n} went ahead on the clock")
    json.dump(state, open(DECISIONS_STATE, "w"), indent=1)

def ops_page():
    """Rebuild the mission-control page and push just that folder, so the dashboard is never more than 15 minutes old."""
    try:
        subprocess.run([sys.executable, os.path.join(ROOT, "tools/ops-page.py")], cwd=ROOT, capture_output=True, timeout=120)
        envp = os.path.expanduser("~/.escp-deploy.env")
        try: subprocess.run([sys.executable, os.path.join(ROOT, "tools/crm.py")], cwd=ROOT, capture_output=True, text=True, timeout=300)
        except Exception as ex: log("crm failed", repr(ex)[:80])
        try: subprocess.run([sys.executable, os.path.join(ROOT, "tools/decisions.py")], cwd=ROOT, capture_output=True, text=True, timeout=120)
        except Exception as ex: log("decisions failed", repr(ex)[:80])
        if os.path.exists(envp):
            env = dict(l.strip().split("=", 1) for l in open(envp) if "=" in l and not l.startswith("#"))
            env = {k: v.strip('"') for k, v in env.items()}
            subprocess.run(["sshpass", "-p", env["DEPLOY_PASS"], "rsync", "-az", "-e", "ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no",
                            os.path.join(ROOT, "site/ops/"), f"{env['DEPLOY_HOST']}:{env['DEPLOY_PATH']}/ops/"], capture_output=True, timeout=120, env={**os.environ, "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"})
        log("ops page rebuilt")
    except Exception as ex:
        log("ops page failed", repr(ex)[:100])


def bounces():
    """Every bounced request gets one more try at a different address: the state directories first
    (another address for the same district), then the district's own website. The same message goes
    again, certificate attachments included. A district with no other address stays bounced."""
    reqs = load(); todo = [r for r in reqs if r.get("status") == "bounced" and not r.get("bounce_retry")]
    if not todo: return 0
    contacts = {}
    for f in os.listdir(os.path.join(ROOT, "data/contacts")):
        if not f.endswith(".json"): continue
        d = json.load(open(os.path.join(ROOT, "data/contacts", f)))
        for c in (d if isinstance(d, list) else d.get("contacts") or []):
            if isinstance(c, dict) and (c.get("district_email") or c.get("email")):
                for k in ((("id", str(c["nces_id"])) if c.get("nces_id") else None), ((c.get("state"), re.sub(r"[^a-z0-9]", "", (c.get("name") or "").lower())) if c.get("state") and c.get("name") else None)):
                    if k: contacts.setdefault(k, []).append((c.get("district_email") or c.get("email")).lower())
    # the website harvest, for everything the directories cannot answer
    need = []
    for r in todo:
        alts = [a for a in contacts.get(("id", str(r.get("nces_id"))), []) + contacts.get((r["state"], re.sub(r"[^a-z0-9]", "", r["name"].lower())), []) if a != (r.get("to") or "").lower() and not re.search(r"@(gmail|yahoo|hotmail|aol)\.", a)]
        r["_alts"] = list(dict.fromkeys(alts))
        if not r["_alts"] and website_of(r): need.append({"name": r["name"], "state": r["state"], "website": website_of(r), "nces_id": r.get("nces_id")})
    harvested = {}
    if need:
        tin = os.path.join(LOGDIR, "bounce-targets.json"); tout = os.path.join(LOGDIR, "bounce-harvest.jsonl")
        json.dump(need, open(tin, "w"))
        if os.path.exists(tout): os.remove(tout)
        try:
            subprocess.run(["node", "tools/contacts/harvest-emails.mjs", tin, tout], cwd=ROOT, capture_output=True, timeout=900)
            for line in open(tout):
                row = json.loads(line); harvested[str(row.get("nces_id") or row.get("name"))] = row.get("superintendent_email") or row.get("generic_email")
        except Exception as ex:
            log("bounce harvest failed", repr(ex)[:100])
    retried = 0
    for r in todo:
        alt = (r.pop("_alts", None) or [None])[0] or harvested.get(str(r.get("nces_id"))) or harvested.get(r["name"])
        r["bounce_retry"] = datetime.datetime.now().isoformat(timespec="seconds")
        if not alt:
            r["notes"] = (r.get("notes") or "") + f" Bounced at {r.get('to')}; no other address found ({r['bounce_retry'][:10]})."; continue
        m = EmailMessage(); m["From"] = FROM; m["To"] = alt; m["Subject"] = r.get("subject") or subject_for(r)
        m["Date"] = email.utils.formatdate(localtime=True); m["Message-ID"] = f"<escp-{r['id']}-r@earthpilot.org>"; m["X-ESCP-Request"] = r["id"]
        body = r.get("body") or body_for(r); m.set_content(body)
        if r.get("kind") == "certificate" and r.get("certificate_pdf") and os.path.exists(os.path.join(ROOT, r["certificate_pdf"])):
            pdf = os.path.join(ROOT, r["certificate_pdf"]); m.add_attachment(open(pdf, "rb").read(), maintype="application", subtype="pdf", filename=os.path.basename(pdf))
            docx = pdf[:-4] + "-press-release.docx"
            if os.path.exists(docx): m.add_attachment(open(docx, "rb").read(), maintype="application", subtype="vnd.openxmlformats-officedocument.wordprocessingml.document", filename=os.path.basename(docx))
        try:
            smtp_send(m)
        except Exception as ex:
            log("bounce resend failed", r["name"], repr(ex)[:100]); continue
        r.setdefault("bounced_from", []).append(r.get("to")); r["to"] = alt; r["status"] = "sent"; r["sent_at"] = datetime.datetime.now().isoformat(timespec="seconds"); r["message_id"] = m["Message-ID"]
        retried += 1; log("bounce: resent", r["state"], r["name"], "->", alt); time.sleep(6)
    save(reqs); log(f"bounces: {retried} resent of {len(todo)}"); return retried


def refile(names=None, ids=None, strict=False):
    """Threads where a document was sent but nothing recorded: try again with the current readers (Drive
    open?id links, pasted policy text, one-hop pages), across every reply in the thread. We told these
    superintendents the record would be updated; this is how it gets done. strict (the cycle's own pass)
    follows attachments and the links triage read as the document, never a link from a signature."""
    reqs = load(); done = 0
    for r in reqs:
        if names and r["name"] not in names: continue
        if ids and r["id"] not in ids: continue
        if not r.get("nces_id"): continue
        if record_status(r).get("quote"): continue
        theirs = [e for e in r.get("replies") or [] if e.get("from") != "us"]
        if not theirs: continue
        filed = []; tried = False
        for e in reversed(theirs):
            path = os.path.join(REPLIES, r["id"], e.get("file") or "")
            if not os.path.exists(path): continue
            msg = email.message_from_bytes(open(path, "rb").read()); body, atts = part_text(msg); frm = email.utils.parseaddr(msg.get("From"))[1]
            pasted = [x for x in clip(triage_mod.strip_quoted(body)) if len(x) > 40]
            links = [] if strict else (e.get("links") or [])
            if not pasted and not atts and not links and not (e.get("facts") or {}).get("document_links"): continue
            tried = True
            if pasted and not atts:
                dd = os.path.join(INBOUND, r["state"]); os.makedirs(dd, exist_ok=True)
                pth = os.path.join(dd, f"{r.get('nces_id') or r['id']}-email-{e.get('file','x')[:8]}.txt")
                open(pth, "w").write(f"Policy text as sent by email from {frm} on {msg.get('Date')}:\n\n{triage_mod.strip_quoted(body)}\n")
                try: got = file_document(r, pth, f"pasted into the district's email reply of {str(msg.get('Date'))[:16]}"); filed += [got] if got else []
                except Exception as ex: log("refile pasted failed", r["name"], repr(ex)[:100])
            if links or atts or (e.get("facts") or {}).get("document_links"):
                try: filed += [g for g in save_docs(r, atts, links, e.get("facts") or {}) if g]
                except Exception as ex: log("refile links failed", r["name"], repr(ex)[:100])
            e["filed"] = [f for f in filed if f] or ["nothing"]
            if record_status(r).get("quote"): break
        if not tried: continue
        rec = record_status(r)
        if rec.get("quote"):
            r["recorded_status"] = rec.get("status"); r.pop("unreadable", None); r.pop("unfiled_since", None); done += 1; log("refiled", r["state"], r["name"], "->", rec.get("status"), (rec.get("source") or "")[:70])
        else:
            r["unreadable"] = datetime.date.today().isoformat(); log("refile: still nothing readable for", r["state"], r["name"])
    save(reqs); log(f"refile: {done} records filled"); return done


def refile_pass(n=1):
    """The cycle's share of the unread documents: a thread whose document arrived and was not recorded is
    read again, three times at most and two days apart (a portal that was down, a reader that has since
    learned the format). What is still unread after that stays on `run.py unfiled` for a person."""
    today = datetime.date.today(); reqs = load(); cleared = 0
    for r in reqs:
        if r.get("unfiled_since") and record_status(r).get("quote"): r.pop("unfiled_since", None); cleared += 1   # filed some other way since
    if cleared: save(reqs)
    due = [r["id"] for r in sorted(reqs, key=lambda r: r.get("refile_tried") or "") if r.get("unfiled_since") and (r.get("refile_tries") or 0) < 3
           and (not r.get("refile_tried") or (today - datetime.date.fromisoformat(r["refile_tried"])).days >= 2)]
    for rid in due[:n]:
        # Counted before the reading, not after: a scan that outlasts the watchdog would otherwise be tried every cycle.
        reqs = load(); r = next(x for x in reqs if x["id"] == rid)
        r["refile_tries"] = (r.get("refile_tries") or 0) + 1; r["refile_tried"] = today.isoformat(); save(reqs)
        refile(ids={rid}, strict=True)
    left = sum(1 for r in load() if r.get("unfiled_since"))
    if due or left: log(f"refile pass: {min(n, len(due))} read again, {left} documents received and not yet on the record")

def unfiled_list():
    """Every thread where the district sent something that is not on the record yet, oldest first."""
    rows = sorted((r for r in load() if r.get("unfiled_since")), key=lambda r: r["unfiled_since"])
    for r in rows:
        last = next((e for e in reversed(r.get("replies") or []) if e.get("unfiled")), {})
        print(f"  {r['unfiled_since']}  {r['state']}  {nice(r['name'])[:34]:<34} tries {r.get('refile_tries') or 0}  " + "; ".join(f"{u['what'][:70]} ({u['outcome']})" for u in last.get("unfiled") or []))
    print(f"\n  {len(rows)} threads with a document received and not yet on the record")


def peers_for(state):
    """What the rest of the state already does, for the invitation: boards that prohibit it in writing, the
    count on record, and whether the practice has stopped statewide (a 'partial' state in data/states)."""
    try:
        rows = json.load(open(os.path.join(ROOT, "site/data/records", f"{state}.json")))
        bans = sum(1 for x in rows if x.get("status") == "bans"); total = len(rows)
        import yaml
        st = yaml.safe_load(open(os.path.join(ROOT, "data/states", f"{state}.yaml")))
        # "No district has used it since" is a claim about one state and one year, so it comes from that
        # state's own file. Kentucky is 'partial' too and reported use as late as 2022-23.
        return {"bans": bans, "total": total, "stopped_statewide": bool(st.get("practice_ended")), "stopped_year": st.get("practice_ended")}
    except Exception: return None

def signs_as(pol):
    """The name they sign with, read off their own replies ('Pat' under a superintendent listed as Patrick Murphy)."""
    try: return writer_mod.signed_as(thread_of(pol), pol.get("superintendent"))
    except Exception: return None

def queue_corrections():
    """One held correction per district that received a certificate on the superintendent's sentence rather than a
    board policy (records now 'silent' with district_says). Threads under the certificate; Anthony reads the batch."""
    import yaml
    reqs = load(); have = {str(r.get("nces_id")) for r in reqs if r.get("kind") == "certificate_correction"}
    names = {}
    try: names = {k: v["name"] for k, v in json.load(open(os.path.join(ROOT, "site/data/states.json"))).items()}
    except Exception: pass
    added = 0
    for f in sorted(os.listdir(os.path.join(ROOT, "data/districts"))):
        if not f.endswith(".yaml"): continue
        st = f[:2]
        for x in yaml.safe_load(open(os.path.join(ROOT, "data/districts", f)))["districts"]:
            if x.get("status") != "silent" or not x.get("district_says") or str(x.get("nces_id")) in have: continue
            cert = next((r for r in reqs if r.get("kind") == "certificate" and str(r.get("nces_id")) == str(x["nces_id"]) and r.get("status") == "sent"), None)
            if not cert: continue
            rid = hashlib.sha1(f"certificate_correction|{st}|{x['nces_id']}".encode()).hexdigest()[:10]
            reqs.append({"id": rid, "state": st, "state_name": names.get(st, st), "name": x["name"], "nces_id": str(x["nces_id"]), "kids": 0, "kind": "certificate_correction", "to": cert["to"],
                         "superintendent": cert.get("superintendent"), "parent_request": cert["id"], "district_says": x["district_says"], "peers": peers_for(st),
                         "status": "held" if HOLD_NEW else "pending", "replies": [], "followup_sent_at": "n/a", "queued_at": datetime.datetime.now().isoformat(timespec="seconds"), "notes": f"Certificate {cert['id']} sent {cert.get('sent_at','')[:16]} quoted the superintendent's email as policy; record reclassified silent 2026-10-27."})
            cert["retracted_at"] = datetime.date.today().isoformat(); cert["notes"] = (cert.get("notes") or "") + " RETRACTED 2026-10-27: quoted the superintendent's email, not a board policy; correction queued."
            pol = next((r for r in reqs if r.get("kind") == "policy" and str(r.get("nces_id")) == str(x["nces_id"])), None)
            if pol:
                pol["claim"] = "the district does not use corporal punishment"; pol["invited_policy_at"] = datetime.date.today().isoformat(); pol["district_says"] = x["district_says"]
                reqs[-1]["signs_as"] = signs_as(pol)
            added += 1
    save(reqs); log(f"queued {added} held certificate corrections")

def queue_align(n=25, states=None, quiet_days=None):
    """Districts whose written policy permits corporal punishment but which reported no use of it: the
    invitation to become a Safe School by aligning the policy with the practice, with the board brief
    attached. Largest districts first; Texas and Oklahoma lead by weight of numbers."""
    import yaml
    lag = sorted(json.load(open(os.path.join(ROOT, "data/outreach/policy-lag.json"))), key=lambda d: -(d.get("enrollment") or 0))   # largest first, whatever order the file is in
    reqs = load(); have = {str(r.get("nces_id")) for r in reqs if r.get("kind") == "align"}
    contacts = {}
    for f in os.listdir(os.path.join(ROOT, "data/contacts")):
        if not f.endswith(".json"): continue
        d = json.load(open(os.path.join(ROOT, "data/contacts", f)))
        for c in (d if isinstance(d, list) else d.get("contacts") or []):
            if isinstance(c, dict) and (c.get("district_email") or c.get("email")):
                if c.get("nces_id"): contacts[("id", str(c["nces_id"]))] = c
                if c.get("state") and c.get("name"): contacts[(c["state"], re.sub(r"[^a-z0-9]", "", c["name"].lower()))] = c
    statutes = {r["state"]: r["statute"] for r in reqs if r.get("statute")}
    # The daily plan passes quiet_days: a district we wrote to in the last two weeks, on any thread, is left alone.
    recent = set()
    if quiet_days:
        cutoff = datetime.datetime.now() - datetime.timedelta(days=quiet_days)
        recent = {str(r.get("nces_id")) for r in reqs if r.get("sent_at") and datetime.datetime.fromisoformat(r["sent_at"][:19]) > cutoff}
    records = district_records()
    added = 0
    for d in lag:
        if added >= n: break
        if d["nces_id"] in have or d["nces_id"] in recent or (states and d["state"] not in states): continue
        rec = records.get(str(d["nces_id"])) or {}
        if rec.get("status") not in ("allows", "consent_required") or not rec.get("quote"): continue   # the record moved since the list was built
        c = contacts.get(("id", d["nces_id"])) or contacts.get((d["state"], re.sub(r"[^a-z0-9]", "", d["name"].lower()))) or {}
        to = c.get("district_email") or c.get("email")
        if not to or re.search(r"@(gmail|yahoo|hotmail|aol)\.", to, re.I): continue
        slug = re.sub(r"[^a-z0-9]+", "-", re.sub(r"\s*\(\d+\)\s*$", "", d["name"]).lower()).strip("-")
        brief = f"out/briefs/{d['state'].lower()}-{slug}.pdf"
        if not os.path.exists(os.path.join(ROOT, brief)):
            r = subprocess.run(["node", "certificates/board-brief.mjs", "--nces", d["nces_id"]], cwd=os.path.join(ROOT, "tools"), capture_output=True, text=True, timeout=180)
            if r.returncode != 0 or not os.path.exists(os.path.join(ROOT, brief)): log("brief failed", d["name"], r.stderr[-120:]); continue
        rid = hashlib.sha1(f"align|{d['state']}|{d['nces_id']}".encode()).hexdigest()[:10]
        reqs.append({"id": rid, "state": d["state"], "name": d["name"], "nces_id": d["nces_id"], "kids": 0, "kind": "align", "to": to, "superintendent": c.get("superintendent"), "peers": peers_for(d["state"]),
                     "statute": statutes.get(d["state"]), "quote": d["quote"], "policy_code": d.get("policy_code"), "attachments": [brief],
                     "status": "held" if HOLD_NEW else "pending", "sent_at": None, "message_id": None, "replies": [], "followup_sent_at": None, "queued_at": datetime.datetime.now().isoformat(timespec="seconds")})
        if game_assign: game_assign.apply(reqs[-1])   # experiment + variant; variant B goes out without the attachment
        added += 1
    save(reqs); log(f"queue-align: {added} queued"); return added

def district_contacts():
    """Superintendent contacts from data/contacts/*.json, keyed by NCES id and by (state, slug)."""
    contacts = {}
    for f in os.listdir(os.path.join(ROOT, "data/contacts")):
        if not f.endswith(".json"): continue
        try: d = json.load(open(os.path.join(ROOT, "data/contacts", f)))
        except Exception: continue
        for c in (d if isinstance(d, list) else d.get("contacts") or []):
            if isinstance(c, dict) and (c.get("district_email") or c.get("email")):
                if c.get("nces_id"): contacts[("id", str(c["nces_id"]))] = c
                if c.get("state") and c.get("name"): contacts[(c["state"], re.sub(r"[^a-z0-9]", "", c["name"].lower()))] = c
    return contacts

def queue_board(n=25, days=14):
    """Board-member notes: for every district whose superintendent got the invitation at least `days` ago and
    has not answered, one short note per board member we have an address for, with a tagged film link.
    Queued held: Anthony sees the first batch before anything sends."""
    sys.path.insert(0, os.path.join(ROOT, "tools/outreach")); import links
    reqs = load(); cutoff = datetime.datetime.now() - datetime.timedelta(days=days)
    done = {str(r.get("nces_id")) for r in reqs if r.get("kind") == "board_note"}
    boards = {}
    for l in open(os.path.join(ROOT, "data/contacts/board-members.jsonl")):
        if l.strip(): b = json.loads(l); boards[str(b["nces_id"])] = b
    added = 0
    for r in [x for x in reqs if x.get("kind") == "align" and x["status"] == "sent"]:
        if added >= n: break
        if str(r["nces_id"]) in done or r.get("replies"): continue
        if not r.get("sent_at") or datetime.datetime.fromisoformat(r["sent_at"][:19]) > cutoff: continue
        b = boards.get(str(r["nces_id"]))
        if not b: continue
        for m in b["members"]:
            if not m.get("email") or re.search(r"@(gmail|yahoo|hotmail|aol)\.", m["email"], re.I): continue
            rid = hashlib.sha1(f"board|{r['state']}|{r['nces_id']}|{m['email'].lower()}".encode()).hexdigest()[:10]
            if any(x["id"] == rid for x in reqs): continue
            reqs.append({"id": rid, "state": r["state"], "name": r["name"], "nces_id": r["nces_id"], "kids": 0, "kind": "board_note", "to": m["email"], "member": m["name"], "role": m.get("role"),
                         "quote": r.get("quote"), "policy_code": r.get("policy_code"), "link": links.make(r["nces_id"], m["email"], "board", m["name"], r["state"]), "parent_request": r["id"],
                         "status": "held" if HOLD_NEW else "pending", "sent_at": None, "message_id": None, "replies": [], "followup_sent_at": None, "queued_at": datetime.datetime.now().isoformat(timespec="seconds")})
        done.add(str(r["nces_id"])); added += 1
    save(reqs); log(f"queue-board: {added} boards queued (held)"); return added

def queue_neighbors(n=25, quiet_days=14):
    """Neighbor asks: permitting districts next to a district that already moved to a ban, largest first, from
    data/game/next-targets.json. Skips any district touched in the last `quiet_days`. Queued held."""
    T = json.load(open(os.path.join(ROOT, "data/game/next-targets.json")))
    reqs = load(); contacts = district_contacts(); cutoff = datetime.datetime.now() - datetime.timedelta(days=quiet_days)
    recent = {str(r.get("nces_id")) for r in reqs if r.get("sent_at") and datetime.datetime.fromisoformat(r["sent_at"][:19]) > cutoff}
    kinds = {}
    for r in reqs: kinds.setdefault(str(r.get("nces_id")), set()).add(r.get("kind"))
    records = district_records()
    # The note asks where the policy is. A district that has already written back, on any thread and under any
    # spelling or missing id, must never get it: Fayetteville AR had answered nine times when this queued one.
    flat = lambda st, nm: (st, re.sub(r"[^a-z0-9]", "", str(nm).lower()))
    heard = {flat(*k) for k in heard_from_set(reqs)}
    had = {flat(r["state"], r["name"]) for r in reqs if r.get("kind") == "neighbor"}
    added = 0
    for t in T["ranked"]:
        if added >= n: break
        nid = str(t["district_id"])
        if nid in recent or "neighbor" in kinds.get(nid, set()) or not t.get("anchors"): continue
        if flat(t["state"], t["name"]) in heard or flat(t["state"], t["name"]) in had: continue
        if (records.get(nid) or {}).get("status") not in ("allows", "consent_required"): continue   # the record moved since the list was built
        c = contacts.get(("id", nid)) or contacts.get((t["state"], re.sub(r"[^a-z0-9]", "", t["name"].lower()))) or {}
        to = t.get("contact_email") or c.get("district_email") or c.get("email")
        if not to or re.search(r"@(gmail|yahoo|hotmail|aol)\.", to, re.I): continue
        # same county first, then the same state: "next door" should not usually mean across a state line
        best = sorted(t["anchors"], key=lambda a: (not a.get("same_county"), str(a.get("district_id"))[:2] != nid[:2], a["name"]))[0]
        anchor = best["name"]
        # the note says where the neighbor is, and only says "next door" when it shares the county
        where = "same_county" if best.get("same_county") else ("next_county" if str(best.get("district_id"))[:2] == nid[:2] else "other_state")
        rid = hashlib.sha1(f"neighbor|{t['state']}|{nid}".encode()).hexdigest()[:10]
        reqs.append({"id": rid, "state": t["state"], "name": t["name"], "nces_id": nid, "kids": 0, "kind": "neighbor", "to": to, "superintendent": c.get("superintendent"), "anchor": anchor, "anchor_where": where,
                     "status": "held" if HOLD_NEW else "pending", "sent_at": None, "message_id": None, "replies": [], "followup_sent_at": None, "queued_at": datetime.datetime.now().isoformat(timespec="seconds")})
        added += 1
    save(reqs); log(f"queue-neighbors: {added} queued" + (" (held)" if HOLD_NEW else "")); return added

def release(kind, states=None):
    """Flip held requests of one kind to pending (optionally only some states) once Anthony has seen the batch."""
    reqs = load(); k = 0
    for r in reqs:
        if r.get("kind") == kind and r["status"] == "held" and (not states or r["state"] in states): r["status"] = "pending"; k += 1
    save(reqs); log(f"release {kind}: {k} released"); return k

# ---------------------------------------------------------------- escalation and the daily plan
RESIDENT_ONLY = {"AR", "TN", "AL"}   # the records law serves residents only (~/foia-exchange/data/states.json): those go to the Request Exchange, never a formal email from out of state
FORMAL_KINDS = {"policy", "nothing on file", "handbook silent"}
FORMAL_AFTER = 10   # business days after the one nudge with no answer

def district_records():
    """Every district record by NCES id, read only (PyYAML never writes these files)."""
    import yaml
    L = getattr(yaml, "CSafeLoader", yaml.SafeLoader); out = {}
    for f in sorted(os.listdir(os.path.join(ROOT, "data/districts"))):
        if not f.endswith(".yaml"): continue
        try: d = yaml.load(open(os.path.join(ROOT, "data/districts", f)), Loader=L)
        except Exception as ex: log("district_records could not read", f, repr(ex)[:80]); continue
        for x in (d if isinstance(d, list) else d.get("districts", [])):
            if x.get("nces_id"): out[str(x["nces_id"])] = x
    return out

def heard_from_set(reqs):
    """(state, name) of every district that has written back on any thread."""
    return {(r["state"], r["name"]) for r in reqs if r.get("status") == "answered" or r.get("last_reply_at")
            or any(e.get("kind") != "auto_reply_or_bounce" for e in r.get("replies") or [])}

def formal_moot(parent, reqs, record=None, heard=None):
    """Why a formal request on this ask would now be wrong, or None when it still stands. Checked when one is
    queued and again at the moment of sending, because a held request can wait days."""
    if parent.get("status") != "sent": return f"the thread is now {parent.get('status')}"
    if parent.get("formal_requested_at"): return "a formal request already went out on this thread"
    if ((parent["state"], parent["name"]) in (heard if heard is not None else heard_from_set(reqs))): return "the district has written back"
    rec = record if record is not None else record_status(parent)
    if rec.get("quote") and rec.get("status") in ("bans", "allows", "consent_required"): return "the policy is on the record now"
    return None

def formal_cohort(reqs=None):
    """The asks that drew no answer to the first note or the nudge, split into those a formal request can go
    to and those in a state whose law serves residents only. One row per district."""
    reqs = reqs if reqs is not None else load()
    laws = json.load(open(os.path.join(ROOT, "data/states/records-laws.json")))
    records = district_records(); heard = heard_from_set(reqs); stop_ids, stop_addrs = stop_sets(reqs)
    have = {r.get("parent_request") for r in reqs if r.get("kind") == "formal_request"}
    due, resident, seen = [], [], set()
    for r in sorted(reqs, key=lambda r: -(r.get("kids") or 0)):   # most children struck first
        if r.get("kind", "policy") not in FORMAL_KINDS or not r.get("followup_sent_at") or r["id"] in have or not r.get("message_id"): continue
        if not re.match(r"\d{4}-\d\d-\d\d", str(r["followup_sent_at"])) or business_days_since(r["followup_sent_at"]) < FORMAL_AFTER: continue   # "n/a" marks an ask that was never nudged
        if str(r.get("nces_id") or "") in stop_ids or (r.get("to") or "").lower() in stop_addrs: continue
        if formal_moot(r, reqs, records.get(str(r.get("nces_id") or ""), {}), heard): continue
        key = str(r.get("nces_id") or (r["state"], r["name"]))
        if key in seen: continue
        seen.add(key)
        if r["state"] in RESIDENT_ONLY: resident.append(r)
        elif laws.get(r["state"]): due.append((r, laws[r["state"]]))
    return due, resident

def queue_formal(n=15):
    """The formal records request as the third touch. The first batch is queued held and waits for Anthony
    with no clock (tools/decisions.py); once one has gone out with his release, later batches go pending."""
    reqs = load(); due, resident = formal_cohort(reqs)
    released = any(r.get("kind") == "formal_request" and r.get("sent_at") for r in reqs)
    waiting = sum(1 for r in reqs if r.get("kind") == "formal_request" and r["status"] == "held")
    if not released and waiting:
        log(f"queue-formal: {waiting} held for Anthony's first look; nothing added ({len(due)} more due, {len(resident)} need a resident requester)"); return 0
    added = 0
    for r, statute in due[:n]:
        rid = hashlib.sha1(f"formal|{r['id']}".encode()).hexdigest()[:10]
        if any(x["id"] == rid for x in reqs): continue
        reqs.append({"id": rid, "state": r["state"], "name": r["name"], "nces_id": r.get("nces_id"), "kids": r.get("kids") or 0, "kind": "formal_request", "to": r["to"],
                     "superintendent": r.get("superintendent"), "statute": statute, "parent_request": r["id"],
                     "status": "pending" if released else "held", "sent_at": None, "message_id": None, "replies": [], "followup_sent_at": None,
                     "queued_at": datetime.datetime.now().isoformat(timespec="seconds")})
        added += 1
    save(reqs); log(f"queue-formal: {added} queued {'pending' if released else 'held for the first look'} ({len(due) - added} more due, {len(resident)} need a resident requester)"); return added

AUTOPILOT = os.path.join(ROOT, "data/outreach/autopilot.json")        # the caps; edit the numbers, or set "enabled": false
AUTOPILOT_STATE = os.path.join(LOGDIR, "autopilot-state.json")        # what each day's run did
AUTOPILOT_DEFAULT = {"enabled": True, "caps": {"first_ask": 15, "neighbor": 10, "align": 5, "formal_request": 15, "board_note": 0}, "hours": [8, 15]}   # Central; wide enough that a laptop opened at 10 Pacific still gets its day

def autopilot(force=False):
    """The daily plan: once each weekday morning (Central), refresh the target lists and queue that day's
    share of each campaign stage, so the pipeline moves without anyone running a command. Each stage has a
    cap in data/outreach/autopilot.json; 0 switches a stage off, "enabled": false or ESCP_AUTOPILOT=0 switches
    the whole plan off. It only queues: send() does the sending, with its stop list and its one-a-day cooldown."""
    cfg = dict(AUTOPILOT_DEFAULT)
    if os.path.exists(AUTOPILOT):
        try: cfg.update(json.load(open(AUTOPILOT)))
        except Exception as ex: log("autopilot: could not read the caps; nothing queued", repr(ex)[:80]); return None
    caps = {**AUTOPILOT_DEFAULT["caps"], **(cfg.get("caps") or {})}
    if not cfg.get("enabled") or os.environ.get("ESCP_AUTOPILOT") == "0": return None
    office = office_now(); today = datetime.date.today().isoformat()
    state = json.load(open(AUTOPILOT_STATE)) if os.path.exists(AUTOPILOT_STATE) else {}
    if not force:
        if office.weekday() >= 5 or not (cfg["hours"][0] <= office.hour < cfg["hours"][1]): return None
        if state.get("last_run") == today: return None
    did = {"at": datetime.datetime.now().isoformat(timespec="seconds")}
    def step(name, fn):
        try: did[name] = fn()
        except Exception as ex: did[name] = f"failed: {repr(ex)[:100]}"; log(f"autopilot: {name} failed", repr(ex)[:160])
    def refresh():
        # Both lists are rebuilt from the record as it stands this morning, so nobody is written to on last month's status.
        # A rebuilt list that comes back empty or at under half its size is a broken build, not news (2026-11-10:
        # a CRLF in one input file produced a list of 0): the old list goes back and the day queues nothing.
        notes = []
        def size(path):
            try: d = json.load(open(os.path.join(ROOT, path))); return len(d) if isinstance(d, list) else len(d.get("ranked") or [])
            except Exception: return 0
        for label, path, cmd in (("policy-lag", "data/outreach/policy-lag.json", ["node", "tools/contacts/build-policy-lag.mjs"]),
                                 ("neighbors", "data/game/next-targets.json", ["/opt/homebrew/bin/python3", "tools/game/neighbors.py"])):
            full = os.path.join(ROOT, path); before = size(path); keep = open(full).read() if os.path.exists(full) else None
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=240, env={**os.environ, "PATH": "/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", "")})
            after = size(path)
            if r.returncode != 0 or after == 0 or after < before / 2:
                if keep is not None: open(full, "w").write(keep)
                raise RuntimeError(f"{label} rebuild looked wrong (exit {r.returncode}, {before} -> {after}); old list restored. {(r.stderr or '')[-80:]}")
            notes.append(f"{label} {after}")
        return ", ".join(notes)
    # First asks need no list: queue() reads the record as it stands. A district whose record was reset, or that
    # turned up silent overnight, gets its first ask the next morning instead of waiting for someone to run `queue`.
    if caps.get("first_ask"): step("first_ask", lambda: queue(caps["first_ask"]))
    step("refresh", refresh)
    if str(did.get("refresh", "")).startswith("failed"):
        # A stale list is how a district that already changed its policy gets asked to change it. No refresh, no new mail.
        alert("autopilot-refresh", "ESCP: the daily plan could not refresh its target lists, so it queued nothing today.")
    else:
        if caps.get("neighbor"): step("neighbor", lambda: queue_neighbors(caps["neighbor"]))
        if caps.get("align"): step("align", lambda: queue_align(caps["align"], quiet_days=14))
        if caps.get("board_note"): step("board_note", lambda: queue_board(caps["board_note"]))
    if caps.get("formal_request"): step("formal_request", lambda: queue_formal(caps["formal_request"]))
    try:
        due, resident = formal_cohort(); did["formal_due"] = len(due); did["needs_resident"] = len(resident)
    except Exception as ex: log("autopilot: cohort count failed", repr(ex)[:100])
    state["last_run"] = today; state.setdefault("days", {})[today] = did
    state["days"] = dict(sorted(state["days"].items())[-60:])
    tmp = AUTOPILOT_STATE + ".tmp"; json.dump(state, open(tmp, "w"), indent=1); os.replace(tmp, AUTOPILOT_STATE)
    log("autopilot:", ", ".join(f"{k} {v}" for k, v in did.items() if k != "at")); return did

# ---------------------------------------------------------------- follow-up
NUDGE_PER_CYCLE = 3     # about one every twenty minutes through the working day
NUDGE_PER_DAY = 60      # 502 went out on 2026-10-27, from midnight on, when the whole 10-10 batch came due at once
NUDGE_HOURS = (8, 17)   # Central time, Monday to Friday; nothing at 2 a.m. signed "Sent from my iPhone"
def office_now():
    """The hour where most of the districts are. The laptop's own clock moved to Pacific in November 2026 and
    'working hours' had quietly become 10 to 7 Central, 11 to 8 Eastern."""
    try:
        import zoneinfo; return datetime.datetime.now(zoneinfo.ZoneInfo("America/Chicago")).replace(tzinfo=None)
    except Exception:
        return datetime.datetime.now()

def followup():
    reqs = load(); n = 0
    now = datetime.datetime.now(); office = office_now()
    if office.weekday() >= 5 or not (NUDGE_HOURS[0] <= office.hour < NUDGE_HOURS[1]):
        log("followup: outside sending hours"); return
    today = now.date().isoformat()
    sent_today = sum(1 for r in reqs if str(r.get("followup_sent_at") or "").startswith(today))
    if sent_today >= NUDGE_PER_DAY:
        log(f"followup: {sent_today} today, daily cap reached"); return
    answered_in_state = {}
    for r in reqs:
        if r.get("kind", "policy") == "policy" and r.get("status") == "answered":
            answered_in_state[r["state"]] = answered_in_state.get(r["state"], 0) + 1
    # Only an ask for the policy gets the "still after your policy" nudge. An apology, certificate, board note,
    # neighbor note or invitation is not an ask and must never be nudged: 24 apologies were, on 2026-11-10,
    # 10 of them to districts that had already sent their policy ("Are you needing me to respond again?").
    NUDGE_KINDS = {"policy", "nothing on file", "handbook silent"}
    heard_from = {(r["state"], r["name"]) for r in reqs if r.get("status") == "answered" or r.get("last_reply_at")
                  or any(e.get("kind") != "auto_reply_or_bounce" for e in r.get("replies") or [])}
    def due(r):
        if r.get("kind", "policy") not in NUDGE_KINDS: return False
        if (r["state"], r["name"]) in heard_from: return False   # the district answered on another thread
        if r["status"] not in ("sent", "promised") or r.get("followup_sent_at"): return False
        if r.get("last_reply_at") or any(e.get("kind") != "auto_reply_or_bounce" for e in r.get("replies") or []): return False   # a thread with a reply never gets a nudge (39 did before 2026-10-27)
        ours = max([r.get("sent_at") or ""] + [str(o.get("at") or "") for o in r.get("our_messages") or []], key=when_ts)
        return business_days_since(ours if "," not in ours else datetime.datetime.fromtimestamp(when_ts(ours)).isoformat()) >= 10
    eligible = sorted((r for r in reqs if due(r)), key=lambda r: -(r.get("kids") or 0))   # most children struck first
    for r in eligible[:min(NUDGE_PER_CYCLE, NUDGE_PER_DAY - sent_today)]:
        m = EmailMessage(); m["From"] = FROM; m["To"] = r["to"]; m["Subject"] = "Re: " + (r.get("subject") or subject_for(r))
        m["In-Reply-To"] = r["message_id"]; m["References"] = r["message_id"]
        body = messages.nudge(r, USER, answered_in_state.get(r["state"], 0)); m.set_content(body)
        try:
            smtp_send(m); r["followup_sent_at"] = datetime.datetime.now().isoformat(timespec="seconds"); n += 1
            r.setdefault("our_messages", []).append({"at": r["followup_sent_at"], "kind": "nudge", "text": body})
            log("nudged", r["state"], r["name"]); save(reqs); time.sleep(8)   # saved per send: a cycle killed mid-loop re-nudged 45 districts on 2026-10-26
        except Exception as e: log("nudge failed", r["name"], e)
    save(reqs); log(f"followup: {n} nudges, {len(eligible) - n} still due")

def desk_pass(limit=None, dry=False):
    """Work the parked threads (desk.py): a few per cycle, the whole backlog by hand."""
    import desk
    reqs = load(); M = imap()
    try:
        mine = anthony_threads(M, reqs)
        if not dry: save(reqs)
    except Exception as ex: log("desk: sent-mail scan failed", repr(ex)[:80]); mine = set()
    n = desk.work(M, reqs, mine, limit=limit or desk.PER_CYCLE, dry=dry, deadline=CYCLE_DEADLINE - 90)
    try: M.logout()
    except Exception: pass
    log(f"desk: {n} threads worked, {sum(1 for r in load() if r['status'] == 'needs_review')} still parked")

def discover(n=1):
    """Look again, on their own site, for the policy of a district that has not sent one: a few per cycle,
    each district once a month. First contacts are exhausted (0 eligible on 2026-10-30); this and the replies
    are how the record keeps growing. Nothing is emailed; a find is filed and published like any other."""
    reqs = load(); cutoff = (datetime.datetime.now() - datetime.timedelta(days=30)).isoformat()
    cands = [r for r in reqs if r.get("kind", "policy") == "policy" and r.get("status") in ("sent", "answered", "closed", "bounced") and r.get("recorded_status") not in ("bans", "allows", "consent_required")
             and (r.get("rechecked_at") or "") < cutoff and (recheck_mod.domain_of(r.get("answered_from") or r.get("to")) or recheck_mod.domain_of(website_of(r)))]
    cands.sort(key=lambda r: -(r.get("kids") or 0)); found = 0; looked = 0
    for r in cands:
        if looked >= n or time.time() > CYCLE_DEADLINE - 200: break
        rec = record_status(r)
        if rec.get("status") in ("bans", "allows", "consent_required") and rec.get("quote"):
            r["recorded_status"] = rec["status"]; continue
        looked += 1
        try: status, tried = recheck_mod.recheck(r, file_document, log=log)
        except recheck_mod.SearchDown as ex: log("discover: search is down, stopping; nothing recorded:", str(ex)[:120]); alert("search-down", f"ESCP: web search is down ({str(ex)[:70]}). Discovery is skipped until it is back."); break
        except Exception as ex: log("discover: recheck failed", r["name"], repr(ex)[:100]); status, tried = None, []
        r["rechecked_at"] = datetime.datetime.now().isoformat(timespec="seconds"); r["recheck_tried"] = tried[:6]
        if status and status != "held": r["recorded_status"] = status; found += 1; log("discover: found", r["state"], r["name"], status)
        save(reqs)
    save(reqs); log(f"discover: {looked} looked at, {found} found, {len(cands)} still to look at")

def queue_nudge_apologies():
    """One held apology per district that got a follow-up after it had already answered (the 2026-10-27 run, before
    the answered check). Threads under the original request; Anthony reads the batch before it goes."""
    reqs = load(); have = {str(r.get("nces_id")) for r in reqs if r.get("kind") == "apology"}; added = 0
    for r in list(reqs):
        if r.get("kind", "policy") != "policy" or not r.get("followup_sent_at") or r["followup_sent_at"] == "n/a": continue
        if not r.get("last_reply_at") or when_ts(r["last_reply_at"]) >= when_ts(r["followup_sent_at"]): continue
        if not any(e.get("kind") != "auto_reply_or_bounce" for e in r.get("replies") or []): continue
        if str(r.get("nces_id")) in have: continue
        rid = hashlib.sha1(f"apology|nudge|{r['id']}".encode()).hexdigest()[:10]
        reqs.append({"id": rid, "state": r["state"], "state_name": r.get("state_name"), "name": r["name"], "nces_id": str(r.get("nces_id")), "kids": r.get("kids") or 0,
                     "kind": "apology", "reason": "nudged_after_reply", "answered_on": r["last_reply_at"], "to": r["to"], "superintendent": r.get("superintendent"),
                     "parent_request": r["id"], "status": "held" if HOLD_NEW else "pending", "replies": [], "followup_sent_at": "n/a", "queued_at": datetime.datetime.now().isoformat(timespec="seconds"),
                     "notes": f"Nudge sent {r['followup_sent_at'][:16]} after their reply of {r['last_reply_at'][:16]}; before the answered check of 2026-10-27."})
        added += 1
    save(reqs); log(f"queued {added} held apologies for follow-ups sent after a reply")

def retriage(send=False):
    """Re-read every stored reply with the current triage, and take the move it calls for.

    Written for the day the taxonomy changed under a backlog: twenty-eight replies had been filed under a
    scheme that had no answer for most of them. Without --send it only says what it would do.
    """
    import glob
    reqs = load(); M = imap() if send else None
    plans = []
    for r in reqs:
        files = sorted(glob.glob(os.path.join(REPLIES, r["id"], "*.eml")), key=os.path.getmtime)
        if not files: continue
        raw = open(files[-1], "rb").read(); msg = email.message_from_bytes(raw)
        frm = email.utils.parseaddr(msg.get("From", ""))[1]
        if not frm or "no-reply" in frm or "noreply" in frm: continue
        # A thread that already produced a record is finished. Re-running the new triage over it would
        # thank the same superintendent twice for the same document, which is worse than doing nothing.
        if r.get("status") in ("answered", "no_policy") and r.get("recorded_status"): continue
        if r.get("status") == "answered": continue
        subject = str(make_header(decode_header(msg.get("Subject", ""))))
        body, atts = part_text(msg)
        links = [u for u in re.findall(r"https?://[^\s<>\")\]]+", body) if "earthpilot" not in u]
        kind, conf, facts = triage_mod.triage(subject, frm, body, [a[0] for a in atts], links)
        move = {"document_attached": "file it and thank them", "document_linked": "fetch the link, file it and thank them",
                "website_no_link": "re-check their own domain, then record it or ask for the direct link",
                "residency_required": "ask what proof they accept, and note it for the exchange",
                "wrong_contact": f"start again with {facts.get('redirect_to') or 'whoever they named'}",
                "no_written_policy": "record no-policy and invite the board to put a prohibition in writing",
                "claims_no_practice": "record the claim and invite the board to put a prohibition in writing",
                "will_send_later": "wait", "auto_reply_or_bounce": "mark the address dead",
                }.get(kind, "draft it for you")
        plans.append((r, kind, conf, move))
        if send:
            mid = msg.get("Message-ID", "").strip() or f"<retriage-{r['id']}@earthpilot.org>"

            try:
                handle_one(M, reqs, r, msg, raw, mid, subject, frm, body, atts, links, quiet=False)
                time.sleep(6)
            except Exception as e:
                log("retriage failed", r["name"], repr(e)[:160])
    if M: M.logout()
    save(reqs)
    for r, kind, conf, move in sorted(plans, key=lambda x: -(x[0].get("kids") or 0)):
        print(f"  {r.get('kids') or 0:>4}  {r['state']}  {nice(r['name'])[:34]:<34} {kind:<20} {'-> ' + move if not send else 'DONE'}")
    print(f"\n  {len(plans)} threads {'handled' if send else 'would be handled'}")

if __name__ == "__main__":
    # One command at a time on requests.json: a cycle holds its copy for minutes while it sends, and a
    # queue run saving in the middle of that would be overwritten (it was, 2026-10-12). Blocking lock.
    import fcntl
    cmd = sys.argv[1] if len(sys.argv) > 1 else "cycle"
    if cmd == "cycle":
        def _watchdog(signum, frame):
            try: log("watchdog: cycle exceeded 13 minutes; aborting so the next one can run")
            except Exception: pass
            os._exit(3)
        signal.signal(signal.SIGALRM, _watchdog)
    _LOCK = open(REQ + ".lock", "w"); fcntl.flock(_LOCK, fcntl.LOCK_EX)
    if cmd == "cycle": signal.alarm(13 * 60); CYCLE_DEADLINE = time.time() + 13 * 60 - 25   # the clock starts once we hold the lock, not while waiting for it
    if cmd == "retriage": retriage(send="--send" in sys.argv); sys.exit()
    if cmd == "tidy": tidy(); sys.exit()
    if cmd == "rehold": rehold(send="--dry" not in sys.argv); sys.exit()
    if cmd == "decide": decide(); sys.exit()
    if cmd == "catchup": catchup(send="--dry" not in sys.argv); sys.exit()
    if cmd == "queue-corrections": queue_corrections(); sys.exit()
    if cmd == "queue-nudge-apologies": queue_nudge_apologies(); sys.exit()
    if cmd == "desk": desk_pass(limit=int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 999, dry="--dry" in sys.argv); sys.exit()
    if cmd == "discover": discover(int(sys.argv[2]) if len(sys.argv) > 2 else 5); sys.exit()
    if cmd == "queue-align": queue_align(int(sys.argv[2]) if len(sys.argv) > 2 else 25, sys.argv[3].split(",") if len(sys.argv) > 3 else None); sys.exit()
    if cmd == "release-align":   # Anthony has seen the held list; let the next cycle send it
        reqs = load(); k = 0; skip = set(sys.argv[sys.argv.index("--not") + 1].split(",")) if "--not" in sys.argv else set()
        for r in reqs:
            if r.get("kind") == "align" and r["status"] == "held" and r["state"] not in skip: r["status"] = "pending"; k += 1
        save(reqs); log(f"release-align: {k} released"); sys.exit()
    if cmd == "release-variant":   # Anthony has read the held batch of an experiment variant: python3 run.py release-variant ask_policy B
        exp, var = sys.argv[2], sys.argv[3]; reqs = load(); k = 0
        for r in reqs:
            if r.get("experiment") == exp and r.get("variant") == var and r["status"] == "held": r["status"] = "pending"; k += 1
        save(reqs); log(f"release-variant: {k} released ({exp} {var}); set approved: true in data/game/experiments.yaml so the next batch is not held"); sys.exit()
    if cmd == "queue": queue(int(sys.argv[2]) if len(sys.argv) > 2 else 25); sys.exit()
    if cmd == "queue-board": queue_board(int(sys.argv[2]) if len(sys.argv) > 2 else 25); sys.exit()
    if cmd == "queue-neighbors": queue_neighbors(int(sys.argv[2]) if len(sys.argv) > 2 else 25); sys.exit()
    if cmd == "queue-formal": queue_formal(int(sys.argv[2]) if len(sys.argv) > 2 else 15); sys.exit()
    if cmd == "formal-dry":   # who a formal request would go to today; changes nothing
        due, resident = formal_cohort()
        print(f"{len(due)} due for a formal request, {len(resident)} in resident-only states (AR, TN, AL) need a resident requester")
        for r, statute in due[:int(sys.argv[2]) if len(sys.argv) > 2 else 15]: print(f"  {r['state']} {r['name'][:38]:38} kids {r.get('kids') or 0:>4}  nudged {r['followup_sent_at'][:10]}  {statute[:50]}")
        sys.exit()
    if cmd == "autopilot": print(json.dumps(autopilot(force="--force" in sys.argv), indent=1)); sys.exit()
    if cmd == "release": release(sys.argv[2], sys.argv[3].split(",") if len(sys.argv) > 3 else None); sys.exit()
    if cmd == "queue-dry":
        import io, contextlib
        reqs0 = load(); queue(int(sys.argv[2]) if len(sys.argv) > 2 else 25); reqs1 = load()
        new = [r for r in reqs1 if r.get("queued_at") and r["status"] == "pending"]
        for r in new: print("  ", r["state"], r["name"][:34], r["kids"], r["to"])
        save(reqs0); print("(dry: nothing kept)"); sys.exit()
    if cmd == "board":
        import track; track.cli(load()); sys.exit()
    if cmd == "unfiled": unfiled_list(); sys.exit()
    if cmd == "refile": refile(names=set(sys.argv[2:]) or None); sys.exit()
    if cmd == "send": send(int(sys.argv[2]) if len(sys.argv) > 2 else 25)
    elif cmd == "inbox": inbox()
    elif cmd == "followup": followup()
    elif cmd == "bounces": bounces()
    elif cmd == "cycle":
        # Order matters under the watchdog: the quick, capped steps and the health line ("ops page rebuilt")
        # come first, and the inbox pass, the one step that can stall on Gmail, runs last so a stall costs
        # only the inbox and never the follow-ups or the ops page (2026-10-26).
        # Each step on its own: a Gmail login failure in send() used to end the whole cycle with a
        # traceback in /tmp and no word to anyone (2026-11-09 04:31).
        for step in (lambda: send(25), followup, tidy, bounces):
            try: step()
            except Exception as ex:
                name = getattr(step, "__name__", "send"); name = "send" if name == "<lambda>" else name
                log(f"{name} failed", repr(ex)[:160]); alert("cycle-" + name, f"ESCP: the {name} step failed ({repr(ex)[:80]}). The rest of the cycle ran.")
        # A superintendent who just sent us a prohibiting policy gets the certificate the same day.
        # send.py takes the same ledger lock per send, so the cycle lets go of it for the duration;
        # holding it deadlocked every cycle from 2026-11-04 to 11-07 (the first day a district qualified
        # after the per-send lock went in), and the watchdog aborted each one before the inbox ran.
        try:
            fcntl.flock(_LOCK, fcntl.LOCK_UN)
            try:
                out = subprocess.run([os.path.join(ROOT, "tools/.venv/bin/python"), os.path.join(ROOT, "tools/certificates/send.py"), "--momentum", "--limit", "3"], cwd=ROOT, capture_output=True, text=True, timeout=420).stdout.strip().splitlines()
            finally:
                fcntl.flock(_LOCK, fcntl.LOCK_EX)
            if out: log("certificates (momentum):", out[-1][:100])
        except Exception as ex:
            log("momentum certificates failed", repr(ex)[:100])
        # The daily plan: once each weekday morning it queues that day's share of each campaign stage.
        # It returns at once on every other cycle of the day.
        try: autopilot()
        except Exception as ex: log("autopilot failed", repr(ex)[:160]); alert("cycle-autopilot", f"ESCP: the daily plan failed ({repr(ex)[:80]}). Nothing new was queued today.")
        try: decide()
        except Exception as ex: log("decide failed", repr(ex)[:100])
        try: discover(1)
        except Exception as ex: log("discover failed", repr(ex)[:100])
        try: ops_page()
        except Exception as ex: log("ops page failed", repr(ex)[:100])
        try: inbox()
        except Exception as ex: log("inbox failed", repr(ex)[:160]); alert("cycle-inbox", f"ESCP: the inbox step failed ({repr(ex)[:80]}). Replies wait for the next cycle.")
        # The parked threads, two a cycle, after the inbox so a slow model call never starves it.
        try: desk_pass()
        except Exception as ex: log("desk failed", repr(ex)[:100])
        # Last, and only with time in hand: one document that arrived and was not recorded is read again.
        try:
            if time.time() < CYCLE_DEADLINE - 300: refile_pass(1)
        except Exception as ex: log("refile pass failed", repr(ex)[:100])
    elif cmd == "compliments":
        # Look up (once) the opening line for every request not yet sent, and show them. Nothing is sent.
        reqs = load(); n = 0
        for r in reqs:
            if r["status"] != "pending": continue
            c = ensure_compliment(r); n += 1
            print(f"{r['state']} {nice(r['name'])}: {c['line'] if c else '(no usable news; no opener)'}")
        save(reqs); print(f"{n} pending requests checked")
    elif cmd == "status":
        reqs = load(); from collections import Counter; print(Counter(r["status"] for r in reqs)); [print(" ", r["state"], r["name"], r["status"], [x["kind"] for x in r["replies"]]) for r in reqs if r["replies"]]
