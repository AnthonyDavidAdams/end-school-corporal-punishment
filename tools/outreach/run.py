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
def save(reqs): json.dump(reqs, open(REQ, "w"), indent=1)
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
    M.select('"[Gmail]/Drafts"'); typ, data = M.search(None, "SUBJECT", f'"{subject}"')
    for num in (data[0].split() if data and data[0] else []):
        M.store(num, "+FLAGS", "\\Deleted")
    M.expunge()
def put_draft(M, msg):
    M.append('"[Gmail]/Drafts"', "\\Draft", imaplib.Time2Internaldate(time.time()), msg.as_bytes())
def text_anthony(line):
    if not SMS: return
    try:
        subprocess.run(["osascript", "-e", f'tell application "Messages" to send {json.dumps(line)} to buddy {json.dumps(SMS)} of (service 1 whose service type is iMessage)'], timeout=20, capture_output=True)
    except Exception as e: log("text failed", e)

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
    if k == "neighbor":
        return messages.neighbor_ask(r, USER, r.get("anchor") or "a neighboring district")
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

COOLDOWN_EXEMPT = ("apology", "certificate_correction")   # these answer a thread of ours and must not wait

def send(limit=25):
    reqs = load(); M = imap(); n = 0; cooled = 0
    for r in reqs:
        if r["status"] != "pending" or n >= limit: continue
        if r.get("kind") not in COOLDOWN_EXEMPT and time.time() - last_contact(r.get("to"), reqs, exclude=r["id"]) < 24 * 3600:
            cooled += 1; continue   # stays pending; the next cycle after the day is up sends it
        subject = r.get("subject") or subject_for(r)
        r["subject"] = subject; r.setdefault("kind", "policy")
        ensure_compliment(r)
        mid = f"<escp-{r['id']}@earthpilot.org>"
        m = EmailMessage(); m["From"] = FROM; m["To"] = r["to"]; m["Subject"] = subject; m["Message-ID"] = mid
        m["Date"] = email.utils.formatdate(localtime=True); m["X-ESCP-Request"] = r["id"]; r["body"] = body_for(r); m.set_content(r["body"])
        if r.get("kind") in ("apology", "certificate_correction") and r.get("parent_request"):   # lands in the thread it corrects
            parent = next((p for p in reqs if p["id"] == r["parent_request"]), None)
            if parent and parent.get("message_id"):
                m["In-Reply-To"] = parent["message_id"]; m["References"] = parent["message_id"]
                del m["Subject"]; subject = "Re: " + re.sub(r"^(re:\s*)+", "", parent.get("subject") or subject_for(parent), flags=re.I); m["Subject"] = subject; r["subject"] = subject
        for att in r.get("attachments") or []:
            pth = os.path.join(ROOT, att)
            if os.path.exists(pth):
                m.add_attachment(open(pth, "rb").read(), maintype="application", subtype="pdf" if pth.endswith(".pdf") else "octet-stream", filename=os.path.basename(pth))
        try:
            smtp_send(m); r["status"] = "sent"; r["sent_at"] = datetime.datetime.now().isoformat(timespec="seconds"); r["message_id"] = mid; n += 1
            delete_draft(M, subject); log("sent", r["state"], r["name"], "->", r["to"]); save(reqs); record_move(r); time.sleep(8)
        except Exception as e:
            log("SEND FAILED", r["name"], e); r["status"] = "error"; r["error"] = str(e)[:200]; save(reqs)
    M.logout(); log(f"send: {n} sent, {sum(1 for r in reqs if r['status']=='pending')} still pending" + (f", {cooled} waiting on the 24-hour cooldown" if cooled else ""))

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
    texts = []; atts = []
    for part in msg.walk():
        ct = part.get_content_type(); fn = part.get_filename()
        if fn: atts.append((str(make_header(decode_header(fn))), part.get_payload(decode=True) or b"", ct)); continue
        if ct == "text/plain": texts.append(part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "ignore"))
        elif ct == "text/html" and not texts:
            h = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "ignore")
            texts.append(htmlmod.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<(script|style)[\s\S]*?</\1>", "", h))))
    t = re.sub(r"[ \t]+", " ", "\n".join(texts)).strip()
    # drop our quoted request from the bottom of a reply
    t = re.split(r"\n(On .{5,80} wrote:|From: Anthony Adams|-----Original Message-----)", t)[0].strip()
    return t, atts
def find_request(msg, reqs):
    refs = (msg.get("In-Reply-To", "") + " " + msg.get("References", ""))
    m = re.search(r"escp-([0-9a-f]{10})@", refs)
    if m: return next((r for r in reqs if r["id"] == m.group(1)), None)
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
        if len(t.strip()) < 500:
            subprocess.run(["ocrmypdf", "--force-ocr", "--sidecar", path + ".txt", "--quiet", path, "/dev/null"], capture_output=True, timeout=1200)
            t = open(path + ".txt").read() if os.path.exists(path + ".txt") else t
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

RULE_RE = re.compile(r"\b(shall|must|may not|will not|prohibit(s|ed)?|permitted|authoriz(es|ed)|the policy (does not|prohibits|allows|permits|states)|policy\s+[A-Z]{0,4}-?\d+)\b", re.I)
FIRST_PERSON_RE = re.compile(r"\b(we|our|us|I|I'm|I've|my|me)\b")
def policy_like(text):
    """True when pasted email text reads like a policy (a rule's verb or a policy code, not written in the first
    person), false when it is the superintendent's own word: "we do not use it" is a claim, never a policy.
    Milan IN, 2026-10-27: one such sentence was filed as a prohibition and a certificate quoted it the same hour."""
    t = triage_mod.strip_quoted(text or "")
    for s in re.split(r"(?<=[.!?\"])\s+|\n{2,}", t):
        if re.search(r"corporal punishment", s, re.I) and RULE_RE.search(s) and not FIRST_PERSON_RE.search(s):
            return True
    return False
def file_document(r, path, how):
    """Clip -> Jev classify -> record -> merge -> publish. Returns the status recorded, or None."""
    scrub(path)
    text = doc_text(path); cands = clip(text)
    if how.startswith("pasted into") and not policy_like(text):
        # Their word, not their policy: the thread keeps it (the writer reads it), the record does not.
        log("email is a statement, not policy text; not filed:", r["name"], (cands[0][:80] if cands else ""))
        try: os.remove(path)
        except OSError: pass
        r["district_says"] = (cands[0].strip()[:300] if cands else None); r["district_says_on"] = datetime.date.today().isoformat()
        return None
    rel = os.path.relpath(path, ROOT); url = RAW + rel
    if not cands:
        log("document silent on corporal punishment:", rel); return None
    row = {"site": None, "district": r["name"], "_state": r["state"], "verdict": "rule", "policies": [{"code": None, "title": f"document received by records request ({how})", "url": url, "candidates": cands[:40], "last_revised": None}]}
    tmp = os.path.join(LOGDIR, f"inbound-{r['id']}.jsonl"); open(tmp, "w").write(json.dumps(row) + "\n")
    cls = os.path.join(LOGDIR, f"inbound-{r['id']}-classified.json"); rec = os.path.join(LOGDIR, f"inbound-{r['id']}-records.json")
    env = dict(os.environ, OPENROUTER_API_KEY=jev_key())
    subprocess.run(["node", "tools/tasb/classify.mjs", "--in", tmp, "--out", cls], cwd=ROOT, env=env, capture_output=True)
    out = subprocess.run(["python3", "tools/tasb/records-from-classified.py", cls, rec, "records_request", "", f"Received from the district by email in answer to a public records request, {datetime.date.today().isoformat()}; the document is kept in the repository at {rel}."], cwd=ROOT, capture_output=True, text=True)
    recs = json.load(open(rec)) if os.path.exists(rec) else []
    for x in recs:
        if not x.get("nces_id") and r.get("nces_id"): x["nces_id"] = r["nces_id"]
    json.dump(recs, open(rec, "w"), indent=1)
    if not recs:
        log("held for review (below threshold):", rel); return "held"
    subprocess.run(["node", "tools/merge-scan.mjs", rec], cwd=ROOT, capture_output=True)
    publish(f"Records request answered: {nice(r['name'])}, {r['state']}")
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
            r.setdefault("our_messages", []).append({"at": h.get("Date"), "to": email.utils.parseaddr(h.get("To", ""))[1], "text": text, "message_id": mid, "by": "anthony"})
        if want: log(f"sent-mail scan: {len(want)} new messages of Anthony's read")
        json.dump(sorted(scanned), open(SENT_SCANNED, "w"))
    except Exception as e: log("sent-mail scan failed", repr(e)[:120])
    return done
def inbox():
    reqs = load(); M = imap(); ensure_label(M); mine = anthony_threads(M, reqs)
    for r in reqs:
        if r["id"] in mine and r["status"] == "anthony_replied": r["status"] = "sent"   # the old lock, lifted
    save(reqs); M.select('"[Gmail]/All Mail"')   # not INBOX: a reply Anthony archived from his phone is still a reply (Norfork, 2026-10-13)
    # Gmail's own search: only mail that could be a reply to us, instead of walking the whole inbox
    # Every subject we have ever sent, not just the ones with "corporal" in them: the research and
    # agency requests would otherwise never have their replies read.
    typ, data = M.search(None, "X-GM-RAW", '"newer_than:21d -from:me -in:drafts (subject:corporal OR subject:\\"records request\\" OR subject:\\"relied on\\" OR subject:\\"handbook\\" OR subject:\\"discipline data\\")"'); seen = {m for r in reqs for m in [x["message_id"] for x in r.get("replies") or []]}
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
HARD_BLOCK = re.compile(r"attorney|lawyer|legal action|cease|desist|stop (contacting|emailing|writing)|do not contact|harass|complaint against|report you|unsubscribe", re.I)
NOTE_MARKS = re.compile(r"\[(HELD|DRAFT)[^\]]*\]|They wrote:|^WHY:|^MOVE:", re.M)
def reply_to(r, frm, mid, subject, text, to=None):
    """One reply on an existing thread. Returns True if it went. A body carrying a reviewer's note never goes."""
    if NOTE_MARKS.search(text or ""):
        log("REFUSED to send: the text carries a reviewer note", r["name"]); return False
    m = EmailMessage(); m["From"] = FROM; m["To"] = to or frm
    subject = " ".join(str(subject).split())   # a folded subject line carries a newline, which a header may not
    m["Subject"] = subject if subject.lower().startswith("re:") else "Re: " + subject
    if not to: m["In-Reply-To"] = mid; m["References"] = mid
    m["Message-ID"] = f"<escp-reply-{hashlib.sha1((r['id'] + mid + text[:40]).encode()).hexdigest()[:12]}@earthpilot.org>"
    m.set_content(text)
    try:
        smtp_send(m)
        r.setdefault("our_messages", []).append({"at": datetime.datetime.now().isoformat(timespec="seconds"), "to": to or frm, "text": text})
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
    for fn, payload, ct in atts:
        if re.search(r"\.(pdf|docx?|txt)$", fn, re.I) and payload:
            p = os.path.join(dd, f"{r.get('nces_id') or r['id']}-{re.sub(r'[^A-Za-z0-9._-]', '_', fn)}")
            open(p, "wb").write(payload); got.append(file_document(r, p, "attached to the district's reply"))
    queue = list(dict.fromkeys((facts.get("document_links") or []) + links))[:4]
    hopped = 0
    while queue:
        u = queue.pop(0)
        for variant in recheck_mod.expand(u):
            ext = ".pdf" if re.search(r"\.pdf|format=pdf", variant, re.I) else ".txt" if "format=txt" in variant else ".html"
            p = os.path.join(dd, tag(variant) + ext)
            if not recheck_mod.fetch(variant, p):
                continue
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
                inner = recheck_mod.links_inside(p, variant)
                if inner:
                    hopped += 1; queue = inner[:3] + queue
            break
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

def record_status(r):
    """What the record says for this district right now (after any merge), with its source and code."""
    try:
        import yaml
        d = yaml.safe_load(open(os.path.join(ROOT, "data/districts", f"{r['state']}.yaml")))
        for x in (d if isinstance(d, list) else d.get("districts", [])):
            if r.get("nces_id") and str(x.get("nces_id")) == str(r["nces_id"]):
                return sane_record(x)
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
        if s is r or s.get("id") == r.get("id") or not s.get("sent_at") or s.get("kind") not in ("certificate", "certificate_correction", "apology"): continue
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
    filed = []
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
        try:
            status, tried = recheck_mod.recheck(r, file_document, log=log)
        except Exception as ex:
            log("recheck failed", r["name"], repr(ex)[:140]); status, tried = None, []
        r["rechecked_at"] = datetime.datetime.now().isoformat(timespec="seconds"); r["recheck_tried"] = tried[:6]
        recheck = {"found": status, "looked_at": tried[:6]}
        if status and status != "held": filed.append(status)
    record = record_status(r)
    recorded = [g for g in filed if g != "held"]
    if recorded:
        r["recorded_status"] = record.get("status") or recorded[0]
        entry["action"] = f"recorded {r['recorded_status']}" + (f" (document said {recorded[0]}; board policy governs)" if record.get("status") and record["status"] != recorded[0] else "")
    if facts.get("claims_no_practice"): r["claims_no_practice"] = True
    if fold:
        entry["action"] = (entry.get("action") or "") + "; filed, answered with their later message in the same batch"; entry["move"] = "fold"
        log("folded", r["state"], r["name"], mid[:40]); finish(); return

    # 3. The whole thread, read by the writer. Then one move.
    thread = thread_of(r, reqs) + [{"who": "them", "date": msg.get("Date"), "text": triage_mod.strip_quoted(body), "links": links[:10], "attachments": [a[0] for a in atts], "kind": kind}]
    filed_desc = [{"what": x, "says": y} for x, y in zip((facts.get("document_links") or []) + [a[0] for a in atts], filed)] or ([{"says": f} for f in filed] if filed else [])
    decision = writer_mod.decide(r, thread, record, filed_desc, facts, recheck, quiet)
    decision = writer_mod.unstock(decision, r, thread, record, filed_desc, facts, recheck, quiet)   # one redraft if it opened with a stock line
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
            if move == "thank_recorded": r["status"] = "answered"
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


def refile(names=None):
    """Threads where a document was sent but nothing recorded: try again with the current readers (Drive
    open?id links, pasted policy text, one-hop pages), across every reply in the thread. We told these
    superintendents the record would be updated; this is how it gets done."""
    reqs = load(); done = 0
    for r in reqs:
        if names and r["name"] not in names: continue
        if record_status(r).get("quote"): continue
        theirs = [e for e in r.get("replies") or [] if e.get("from") != "us"]
        if not theirs: continue
        filed = []; tried = False
        for e in reversed(theirs):
            path = os.path.join(REPLIES, r["id"], e.get("file") or "")
            if not os.path.exists(path): continue
            msg = email.message_from_bytes(open(path, "rb").read()); body, atts = part_text(msg); frm = email.utils.parseaddr(msg.get("From"))[1]
            pasted = [x for x in clip(triage_mod.strip_quoted(body)) if len(x) > 40]
            if not pasted and not atts and not e.get("links"): continue
            tried = True
            if pasted and not atts:
                dd = os.path.join(INBOUND, r["state"]); os.makedirs(dd, exist_ok=True)
                pth = os.path.join(dd, f"{r.get('nces_id') or r['id']}-email-{e.get('file','x')[:8]}.txt")
                open(pth, "w").write(f"Policy text as sent by email from {frm} on {msg.get('Date')}:\n\n{triage_mod.strip_quoted(body)}\n")
                try: got = file_document(r, pth, f"pasted into the district's email reply of {str(msg.get('Date'))[:16]}"); filed += [got] if got else []
                except Exception as ex: log("refile pasted failed", r["name"], repr(ex)[:100])
            if e.get("links") or atts:
                try: filed += [g for g in save_docs(r, atts, e.get("links") or [], e.get("facts") or {}) if g]
                except Exception as ex: log("refile links failed", r["name"], repr(ex)[:100])
            e["filed"] = [f for f in filed if f] or ["nothing"]
            if record_status(r).get("quote"): break
        if not tried: continue
        rec = record_status(r)
        if rec.get("quote"):
            r["recorded_status"] = rec.get("status"); r.pop("unreadable", None); done += 1; log("refiled", r["state"], r["name"], "->", rec.get("status"), (rec.get("source") or "")[:70])
        else:
            r["unreadable"] = datetime.date.today().isoformat(); log("refile: still nothing readable for", r["state"], r["name"])
    save(reqs); log(f"refile: {done} records filled"); return done


def peers_for(state):
    """What the rest of the state already does, for the invitation: boards that prohibit it in writing, the
    count on record, and whether the practice has stopped statewide (a 'partial' state in data/states)."""
    try:
        rows = json.load(open(os.path.join(ROOT, "site/data/records", f"{state}.json")))
        bans = sum(1 for x in rows if x.get("status") == "bans"); total = len(rows)
        import yaml
        st = yaml.safe_load(open(os.path.join(ROOT, "data/states", f"{state}.yaml")))
        return {"bans": bans, "total": total, "stopped_statewide": st.get("status") == "partial"}
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
                         "status": "held", "replies": [], "followup_sent_at": "n/a", "queued_at": datetime.datetime.now().isoformat(timespec="seconds"), "notes": f"Certificate {cert['id']} sent {cert.get('sent_at','')[:16]} quoted the superintendent's email as policy; record reclassified silent 2026-10-27."})
            cert["retracted_at"] = datetime.date.today().isoformat(); cert["notes"] = (cert.get("notes") or "") + " RETRACTED 2026-10-27: quoted the superintendent's email, not a board policy; correction queued."
            pol = next((r for r in reqs if r.get("kind") == "policy" and str(r.get("nces_id")) == str(x["nces_id"])), None)
            if pol:
                pol["claim"] = "the district does not use corporal punishment"; pol["invited_policy_at"] = datetime.date.today().isoformat(); pol["district_says"] = x["district_says"]
                reqs[-1]["signs_as"] = signs_as(pol)
            added += 1
    save(reqs); log(f"queued {added} held certificate corrections")

def queue_align(n=25, states=None):
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
    added = 0
    for d in lag:
        if added >= n: break
        if d["nces_id"] in have or (states and d["state"] not in states): continue
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
                     "status": "held", "sent_at": None, "message_id": None, "replies": [], "followup_sent_at": None, "queued_at": datetime.datetime.now().isoformat(timespec="seconds")})
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
                         "status": "held", "sent_at": None, "message_id": None, "replies": [], "followup_sent_at": None, "queued_at": datetime.datetime.now().isoformat(timespec="seconds")})
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
    added = 0
    for t in T["ranked"]:
        if added >= n: break
        nid = str(t["district_id"])
        if nid in recent or "neighbor" in kinds.get(nid, set()) or not t.get("anchors"): continue
        c = contacts.get(("id", nid)) or contacts.get((t["state"], re.sub(r"[^a-z0-9]", "", t["name"].lower()))) or {}
        to = t.get("contact_email") or c.get("district_email") or c.get("email")
        if not to or re.search(r"@(gmail|yahoo|hotmail|aol)\.", to, re.I): continue
        anchor = sorted(t["anchors"], key=lambda a: (not a.get("same_county"), a["name"]))[0]["name"]
        rid = hashlib.sha1(f"neighbor|{t['state']}|{nid}".encode()).hexdigest()[:10]
        reqs.append({"id": rid, "state": t["state"], "name": t["name"], "nces_id": nid, "kids": 0, "kind": "neighbor", "to": to, "superintendent": c.get("superintendent"), "anchor": anchor,
                     "status": "held", "sent_at": None, "message_id": None, "replies": [], "followup_sent_at": None, "queued_at": datetime.datetime.now().isoformat(timespec="seconds")})
        added += 1
    save(reqs); log(f"queue-neighbors: {added} queued (held)"); return added

def release(kind, states=None):
    """Flip held requests of one kind to pending (optionally only some states) once Anthony has seen the batch."""
    reqs = load(); k = 0
    for r in reqs:
        if r.get("kind") == kind and r["status"] == "held" and (not states or r["state"] in states): r["status"] = "pending"; k += 1
    save(reqs); log(f"release {kind}: {k} released"); return k

# ---------------------------------------------------------------- follow-up
def followup():
    reqs = load(); n = 0
    for r in reqs:
        if n >= 15: break   # at most 15 nudges per cycle; the rest wait for the next one
        answered = r.get("last_reply_at") or any(e.get("kind") != "auto_reply_or_bounce" for e in r.get("replies") or [])
        if answered: continue   # a thread with a reply never gets "in case it got buried" (39 did before 2026-10-27)
        ours = max([r.get("sent_at") or ""] + [str(o.get("at") or "") for o in r.get("our_messages") or []], key=when_ts)
        if r["status"] in ("sent", "promised") and not r.get("followup_sent_at") and business_days_since(ours if "," not in ours else datetime.datetime.fromtimestamp(when_ts(ours)).isoformat()) >= 10:
            m = EmailMessage(); m["From"] = FROM; m["To"] = r["to"]; m["Subject"] = "Re: " + (r.get("subject") or subject_for(r))
            m["In-Reply-To"] = r["message_id"]; m["References"] = r["message_id"]; m.set_content(messages.nudge(r, USER))
            try: smtp_send(m); r["followup_sent_at"] = datetime.datetime.now().isoformat(timespec="seconds"); n += 1; log("nudged", r["state"], r["name"]); save(reqs); time.sleep(8)   # saved per send: a cycle killed mid-loop re-nudged 45 districts on 2026-10-26
            except Exception as e: log("nudge failed", r["name"], e)
    save(reqs); log(f"followup: {n} nudges")

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
    if cmd == "release": release(sys.argv[2], sys.argv[3].split(",") if len(sys.argv) > 3 else None); sys.exit()
    if cmd == "queue-dry":
        import io, contextlib
        reqs0 = load(); queue(int(sys.argv[2]) if len(sys.argv) > 2 else 25); reqs1 = load()
        new = [r for r in reqs1 if r.get("queued_at") and r["status"] == "pending"]
        for r in new: print("  ", r["state"], r["name"][:34], r["kids"], r["to"])
        save(reqs0); print("(dry: nothing kept)"); sys.exit()
    if cmd == "board":
        import track; track.cli(load()); sys.exit()
    if cmd == "send": send(int(sys.argv[2]) if len(sys.argv) > 2 else 25)
    elif cmd == "inbox": inbox()
    elif cmd == "followup": followup()
    elif cmd == "bounces": bounces()
    elif cmd == "cycle":
        # Order matters under the watchdog: the quick, capped steps and the health line ("ops page rebuilt")
        # come first, and the inbox pass, the one step that can stall on Gmail, runs last so a stall costs
        # only the inbox and never the follow-ups or the ops page (2026-10-26).
        send(25); followup(); tidy(); bounces()
        # A superintendent who just sent us a prohibiting policy gets the certificate the same day.
        try:
            out = subprocess.run([os.path.join(ROOT, "tools/.venv/bin/python"), os.path.join(ROOT, "tools/certificates/send.py"), "--momentum", "--limit", "20"], cwd=ROOT, capture_output=True, text=True, timeout=1500).stdout.strip().splitlines()
            if out: log("certificates (momentum):", out[-1][:100])
        except Exception as ex:
            log("momentum certificates failed", repr(ex)[:100])
        try: decide()
        except Exception as ex: log("decide failed", repr(ex)[:100])
        ops_page()
        inbox()
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
