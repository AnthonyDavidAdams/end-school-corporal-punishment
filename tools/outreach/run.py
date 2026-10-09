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
    d = nice(r["name"])
    return {
        "policy":   f"{d} corporal punishment policy",
        "minutes":  f"Records request: {d} board minutes on corporal punishment",
        "research": f"Records request: what {d}'s board relied on",
        "state_doe": f"Records request: district contacts, handbooks and discipline data",
    }.get(r.get("kind", "policy"), f"Can't find {d}'s corporal punishment policy")

def body_for(r):
    k = r.get("kind", "policy")
    statute = r.get("statute") or "your state's public records law"
    if k == "minutes":
        return messages.ask_minutes(r, USER, statute, r.get("claim", "the practice has stopped"))
    if k == "research":
        return messages.ask_research(r, USER, statute)
    if k == "state_doe":
        return messages.state_doe(r.get("state_name", r["state"]), r["state"], statute, USER, r.get("dept", "department of education"))
    return messages.ask_policy(r, USER, r.get("compliment"))

# ---------------------------------------------------------------- send
def send(limit=25):
    reqs = load(); M = imap(); n = 0
    for r in reqs:
        if r["status"] != "pending" or n >= limit: continue
        subject = r.get("subject") or subject_for(r)
        r["subject"] = subject; r.setdefault("kind", "policy")
        ensure_compliment(r)
        mid = f"<escp-{r['id']}@earthpilot.org>"
        m = EmailMessage(); m["From"] = FROM; m["To"] = r["to"]; m["Subject"] = subject; m["Message-ID"] = mid
        m["Date"] = email.utils.formatdate(localtime=True); m["X-ESCP-Request"] = r["id"]; r["body"] = body_for(r); m.set_content(r["body"])
        try:
            smtp_send(m); r["status"] = "sent"; r["sent_at"] = datetime.datetime.now().isoformat(timespec="seconds"); r["message_id"] = mid; n += 1
            delete_draft(M, subject); log("sent", r["state"], r["name"], "->", r["to"]); save(reqs); time.sleep(8)
        except Exception as e:
            log("SEND FAILED", r["name"], e); r["status"] = "error"; r["error"] = str(e)[:200]; save(reqs)
    M.logout(); log(f"send: {n} sent, {sum(1 for r in reqs if r['status']=='pending')} still pending")

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
        M.store(num, "+X-GM-LABELS", f'"{LABEL}"'); M.store(num, "+FLAGS", "\\Deleted"); return True
    except Exception as e:
        log("label failed", repr(e)[:80]); return False
def tidy():
    """One pass over the inbox: every message that belongs to a request thread gets the label and leaves the inbox."""
    reqs = load(); M = imap(); ensure_label(M); M.select("INBOX"); moved = 0
    typ, data = M.search(None, "X-GM-RAW", '"newer_than:90d (subject:corporal OR subject:\\"records request\\" OR subject:\\"relied on\\" OR subject:handbook OR subject:\\"discipline data\\" OR subject:\\"safe schools\\")"')
    for num in (data[0].split() if data and data[0] else []):
        typ, raw = M.fetch(num, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT IN-REPLY-TO REFERENCES MESSAGE-ID)])"); h = email.message_from_bytes(raw[0][1])
        frm = email.utils.parseaddr(h.get("From", ""))[1].lower()
        if "no-reply" in frm or "noreply" in frm or "substack" in frm or "medium.com" in frm: continue
        subj = str(h.get("Subject") or "")
        ours = find_request(h, reqs) or re.search(r"corporal|safe schools", subj, re.I) or re.search(r"\.k12\.|schools?\.|\.org$|isd\.|sd\.", frm)
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
    if path.lower().endswith(".pdf"):
        t = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True).stdout
        if len(t.strip()) < 500:
            subprocess.run(["ocrmypdf", "--force-ocr", "--sidecar", path + ".txt", "--quiet", path, "/dev/null"], capture_output=True, timeout=1200)
            t = open(path + ".txt").read() if os.path.exists(path + ".txt") else t
        return t
    if path.lower().endswith((".docx", ".doc")):
        return subprocess.run(["textutil", "-convert", "txt", "-stdout", path], capture_output=True, text=True).stdout
    return open(path, encoding="utf-8", errors="ignore").read()
def file_document(r, path, how):
    """Clip -> Jev classify -> record -> merge -> publish. Returns the status recorded, or None."""
    text = doc_text(path); cands = clip(text)
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
def anthony_threads(M, reqs):
    """Anthony's own replies from Sent Mail, folded into each request's our_messages (by: anthony) so the
    writer reads them as part of the thread. Returns the request ids he has written in. Since 2026-10-09
    his presence is context, not a lock: the job keeps answering unless hold_replies is set on the request."""
    done = set()
    try:
        M.select('"[Gmail]/Sent Mail"')
        typ, data = M.search(None, "X-GM-RAW", '"newer_than:120d (subject:corporal OR subject:\"records request\" OR subject:handbook OR subject:\"safe schools\")"')
        for num in (data[0].split() if data and data[0] else []):
            typ, raw = M.fetch(num, "(RFC822)"); h = email.message_from_bytes(raw[0][1])
            if not h.get("In-Reply-To"): continue          # our own outbound requests are not replies
            mid = h.get("Message-ID") or ""
            if "escp-" in mid: continue                     # the job's own automated replies and hand-sent ones logged elsewhere
            r = find_request(h, reqs)
            if not r:
                to = email.utils.parseaddr(h.get("To", ""))[1].lower(); r = next((x for x in reqs if (x.get("to") or "").lower() == to), None)
            if not r: continue
            done.add(r["id"])
            if not any(o.get("message_id") == mid for o in r.get("our_messages") or []):
                text, _ = part_text(h)
                r.setdefault("our_messages", []).append({"at": h.get("Date"), "to": email.utils.parseaddr(h.get("To", ""))[1], "text": text, "message_id": mid, "by": "anthony"})
    except Exception as e: log("sent-mail scan failed", e)
    return done
def inbox():
    reqs = load(); M = imap(); ensure_label(M); mine = anthony_threads(M, reqs)
    for r in reqs:
        if r["id"] in mine and r["status"] == "anthony_replied": r["status"] = "sent"   # the old lock, lifted
    save(reqs); M.select("INBOX")
    # Gmail's own search: only mail that could be a reply to us, instead of walking the whole inbox
    # Every subject we have ever sent, not just the ones with "corporal" in them: the research and
    # agency requests would otherwise never have their replies read.
    typ, data = M.search(None, "X-GM-RAW", '"newer_than:60d (subject:corporal OR subject:\\"records request\\" OR subject:\\"relied on\\" OR subject:\\"handbook\\" OR subject:\\"discipline data\\")"'); seen = {m for r in reqs for m in [x["message_id"] for x in r["replies"]]}
    handled = 0
    for num in (data[0].split() if data and data[0] else []):
        typ, raw = M.fetch(num, "(BODY.PEEK[])"); msg = email.message_from_bytes(raw[0][1])
        mid = msg.get("Message-ID", "").strip()
        if not mid or mid in seen: continue
        r = find_request(msg, reqs)
        if not r: continue
        subject = str(make_header(decode_header(msg.get("Subject", "")))); frm = email.utils.parseaddr(msg.get("From", ""))[1]
        body, atts = part_text(msg); links = [u for u in re.findall(r"https?://[^\s<>\")\]]+", body) if "earthpilot" not in u]
        try:
            handle_one(M, reqs, r, msg, raw[0][1], mid, subject, frm, body, atts, links, quiet=False); handled += 1
            M.select("INBOX"); file_away(M, num)
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
def reply_to(r, frm, mid, subject, text, to=None):
    """One reply on an existing thread. Returns True if it went."""
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

def record_status(r):
    """What the record says for this district right now (after any merge), with its source and code."""
    try:
        import yaml
        d = yaml.safe_load(open(os.path.join(ROOT, "data/districts", f"{r['state']}.yaml")))
        for x in (d if isinstance(d, list) else d.get("districts", [])):
            if r.get("nces_id") and str(x.get("nces_id")) == str(r["nces_id"]):
                return x
    except Exception as ex:
        log("record_status failed", repr(ex)[:80])
    return {}

def asks_us_back(body):
    """A reply that is a question to us ('are you saying...?') rather than an answer."""
    t = triage_mod.strip_quoted(body)
    return bool(re.search(r"\?\s*$", t.strip()) or re.search(r"\b(are you saying|what do you mean|why (do|did|are) you|can you (explain|clarify)|please (explain|clarify)|contradict)", t, re.I))

def thread_of(r):
    """Every message in this thread, ours and theirs, oldest first: what the model reads before it writes."""
    msgs = []
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


def handle_one(M, reqs, r, msg, rawbytes, mid, subject, frm, body, atts, links, quiet=False):
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

    if kind == "auto_reply_or_bounce":
        if re.search(r"delivery|undeliver|failure|not delivered|couldn't be found", subject + body[:600], re.I):
            r["status"] = "bounced"
        entry["action"] = "logged"; finish(); return

    # 1. Everything the reply carries, filed. The merge decides what the record says afterwards.
    filed = []
    if atts or links:
        try:
            got = save_docs(r, atts, links, facts)
        except Exception as ex:
            log("save_docs failed", r["name"], repr(ex)[:120]); got = []
        filed = [g for g in got if g]
        if "held" in filed: entry["held_documents"] = True
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

    # 3. The whole thread, read by the writer. Then one move.
    thread = thread_of(r) + [{"who": "them", "date": msg.get("Date"), "text": triage_mod.strip_quoted(body), "links": links[:10], "attachments": [a[0] for a in atts], "kind": kind}]
    filed_desc = [{"what": x, "says": y} for x, y in zip((facts.get("document_links") or []) + [a[0] for a in atts], filed)] or ([{"says": f} for f in filed] if filed else [])
    decision = writer_mod.decide(r, thread, record, filed_desc, facts, recheck, quiet)
    move = decision["move"] if decision else "hold"
    text = decision["reply"] if decision else None
    why = decision["why"] if decision else f"the writer returned nothing usable ({writer_mod.LAST_ERROR[0]})"
    their_replies = sum(1 for m in thread if m["who"] == "them")
    # The limits code keeps whatever the model chose.
    if move == "ask_minutes" and (record.get("status") == "bans" or their_replies > 1 or r.get("residency_required")):
        move, why = "hold", f"minutes request blocked by rule ({'policy already prohibits' if record.get('status') == 'bans' else 'not a first reply' if their_replies > 1 else 'needs a resident'}); {why}"
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
    ok = bool(text) and move != "hold" and writer_mod.check(text, thread, record)
    if text and move != "hold" and not ok:
        move, why = "hold", "the referee held it; " + why

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
            elif move == "records_request": r["formal_requested_at"] = datetime.date.today().isoformat(); r["status"] = "sent"
            else: r["status"] = "sent"
        else:
            r["status"] = "needs_review"; entry["action"] = (entry.get("action") or "") + "; reply failed to send"
    elif not text and re.search(r"acknowledg|no reply needed|nothing to answer|no response needed", why, re.I):
        entry["action"] = (entry.get("action") or "") + f"; logged, no reply needed: {why}"
        r["status"] = r.get("status") if r.get("status") in ("promised", "answered") else "sent"
    else:
        r["status"] = "anthony_replied" if quiet else "needs_review"
        entry["action"] = (entry.get("action") or "") + ("; logged, Anthony is handling this thread" if quiet else f"; held for Anthony: {why}")
        if text: entry["suggested"] = text
        if not quiet:
            m = EmailMessage(); m["From"] = FROM; m["To"] = frm; m["Subject"] = "Re: " + " ".join(str(subject).split())
            m["In-Reply-To"] = mid; m["References"] = mid
            m.set_content((text or "") + f"\n\n\n[HELD — {why}]\n\nThey wrote:\n\n{triage_mod.strip_quoted(body)[:1500]}\n")
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
            k = contacts.get((st, re.sub(r"[^a-z0-9]", "", x["name"].lower()))) or {}
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
        if (e.get("links") or atts) and not e.get("filed"):
            try: filed = [g for g in save_docs(r, atts, e.get("links") or [], e.get("facts") or {}) if g]
            except Exception as ex: log("catchup save_docs failed", r["name"], repr(ex)[:100])
            e["filed"] = filed or ["nothing"]
        thread = thread_of(r); record = record_status(r)
        recorded = [f for f in filed if f != "held"]
        if recorded: r["recorded_status"] = record.get("status") or recorded[0]
        d = writer_mod.decide(r, thread, record, [{"says": f} for f in recorded], e.get("facts") or {}, {"found": None, "looked_at": r.get("recheck_tried") or []} if r.get("rechecked_at") else None, False)
        move = d["move"] if d else "hold"; text = d["reply"] if d else None; why = d["why"] if d else f"writer: {writer_mod.LAST_ERROR[0]}"
        their = len([x for x in thread if x["who"] == "them"])
        if move == "ask_minutes" and (record.get("status") == "bans" or their > 1 or r.get("residency_required")): move = "hold"
        if move in ("forward",): move = "hold"
        if move == "records_request" and (r.get("formal_requested_at") or recorded or atts): move = "hold"
        if move != "hold" and re.search(r"\$\s*(\d[\d,]*(?:\.\d+)?)", triage_mod.strip_quoted(body)) and max(float(a.replace(",", "")) for a in re.findall(r"\$\s*(\d[\d,]*(?:\.\d+)?)", triage_mod.strip_quoted(body))) > 5: move = "hold"
        ok = bool(text) and move != "hold" and writer_mod.check(text, thread, record)
        if ok and send and reply_to(r, frm, e["message_id"], subject, text):
            e["our_reply"] = text; e["move"] = move; e["why"] = why; e["action"] = (e.get("action") or "") + f"; catch-up reply ({move})"
            if move == "records_request": r["formal_requested_at"] = datetime.date.today().isoformat()
            r["status"] = "answered" if move == "thank_recorded" else "sent"; sent += 1; log("catchup sent", r["state"], r["name"], move)
        elif not text and re.search(r"acknowledg|no reply needed|nothing to answer", why, re.I):
            e["action"] = (e.get("action") or "") + f"; catch-up: no reply needed ({why[:80]})"
        else:
            e["suggested"] = text; e["why"] = why; e["move"] = "hold"; r["status"] = "needs_review"; held += 1
            if text:
                delete_draft(M, "Re: " + " ".join(subject.split()))
                m = EmailMessage(); m["From"] = FROM; m["To"] = frm; m["Subject"] = "Re: " + " ".join(subject.split()); m["In-Reply-To"] = e["message_id"]; m["References"] = e["message_id"]
                m.set_content(text + f"\n\n\n[HELD — {why}]\n\nThey wrote:\n\n{triage_mod.strip_quoted(body)[:1500]}\n"); put_draft(M, m)
            log("catchup held", r["state"], r["name"], why[:100])
        save(reqs)
    M.logout(); log(f"catchup: {sent} sent, {held} held")


def rehold(send=True):
    """Threads held for a person: decide again with the whole thread. Sends when the writer picks a move and
    the referee passes; otherwise refreshes the draft with the suggested text. Never touches a thread
    Anthony has written in, and never re-answers a message that already got a reply from us."""
    reqs = load(); M = imap(); mine = anthony_threads(M, reqs); sent = held = 0
    for r in reqs:
        if r.get("status") != "needs_review" or r["id"] in mine or not r.get("replies"): continue
        e = r["replies"][-1]
        if e.get("from") == "us" or e.get("our_reply") or e.get("move") not in (None, "hold"): continue
        path = os.path.join(REPLIES, r["id"], e.get("file") or "")
        if not os.path.exists(path): continue
        msg = email.message_from_bytes(open(path, "rb").read()); body, atts = part_text(msg)
        frm = email.utils.parseaddr(msg.get("From"))[1]; subject = str(make_header(decode_header(msg.get("Subject") or "")))
        # Links and attachments the first pass did not get through are filed now, so the writer sees what they said.
        filed = []
        links = e.get("links") or []
        if (links or atts) and not e.get("filed"):
            try:
                filed = [g for g in save_docs(r, atts, links, e.get("facts") or {}) if g]
            except Exception as ex:
                log("rehold save_docs failed", r["name"], repr(ex)[:100])
            e["filed"] = filed or ["nothing"]
        thread = thread_of(r); record = record_status(r)
        filed_desc = [{"says": f} for f in filed if f != "held"]
        d = writer_mod.decide(r, thread, record, filed_desc, e.get("facts") or {}, {"found": None, "looked_at": r.get("recheck_tried") or []} if r.get("rechecked_at") else None, False)
        move = d["move"] if d else "hold"; text = d["reply"] if d else None; why = d["why"] if d else f"writer: {writer_mod.LAST_ERROR[0]}"
        their = sum(1 for m in thread if m["who"] == "them")
        if move == "ask_minutes" and (record.get("status") == "bans" or their > 1 or r.get("residency_required")): move = "hold"
        if move == "forward": move = "hold"
        if move == "records_request" and r.get("formal_requested_at"): move = "hold"
        ok = bool(text) and move != "hold" and writer_mod.check(text, thread, record)
        if ok and send and reply_to(r, frm, e["message_id"], subject, text):
            e["our_reply"] = text; e["move"] = move; e["why"] = why; e["action"] = (e.get("action") or "") + f"; re-decided and replied ({move})"
            if move == "records_request": r["formal_requested_at"] = datetime.date.today().isoformat()
            r["status"] = "answered" if move == "thank_recorded" else "sent"; sent += 1
            log("rehold sent", r["state"], r["name"], move)
        else:
            e["suggested"] = text; e["why"] = why; held += 1
            if text:
                delete_draft(M, "Re: " + " ".join(subject.split()))
                m = EmailMessage(); m["From"] = FROM; m["To"] = frm; m["Subject"] = "Re: " + " ".join(subject.split()); m["In-Reply-To"] = e["message_id"]; m["References"] = e["message_id"]
                m.set_content(text + f"\n\n\n[HELD — {why}]\n\nThey wrote:\n\n{triage_mod.strip_quoted(body)[:1500]}\n"); put_draft(M, m)
            log("rehold held", r["state"], r["name"], why[:100])
        save(reqs)
    M.logout(); log(f"rehold: {sent} sent, {held} still held")

# ---------------------------------------------------------------- follow-up
def followup():
    reqs = load(); n = 0
    for r in reqs:
        if r["status"] in ("sent", "promised") and not r.get("followup_sent_at") and business_days_since(r.get("sent_at")) >= 10:
            m = EmailMessage(); m["From"] = FROM; m["To"] = r["to"]; m["Subject"] = "Re: " + (r.get("subject") or subject_for(r))
            m["In-Reply-To"] = r["message_id"]; m["References"] = r["message_id"]; m.set_content(messages.nudge(r, USER))
            try: smtp_send(m); r["followup_sent_at"] = datetime.datetime.now().isoformat(timespec="seconds"); n += 1; log("nudged", r["state"], r["name"]); time.sleep(8)
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
                "no_written_policy": "record no-policy and send the grant offer",
                "claims_no_practice": "record the claim and ask for the board minutes",
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
    cmd = sys.argv[1] if len(sys.argv) > 1 else "cycle"
    if cmd == "retriage": retriage(send="--send" in sys.argv); sys.exit()
    if cmd == "tidy": tidy(); sys.exit()
    if cmd == "rehold": rehold(send="--dry" not in sys.argv); sys.exit()
    if cmd == "catchup": catchup(send="--dry" not in sys.argv); sys.exit()
    if cmd == "queue": queue(int(sys.argv[2]) if len(sys.argv) > 2 else 25); sys.exit()
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
    elif cmd == "cycle": send(25); inbox(); followup(); tidy()
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
