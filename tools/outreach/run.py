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
        "policy":   f"Can't find {d}'s corporal punishment policy",
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
    try:
        M.store(num, "+X-GM-LABELS", f'"{LABEL}"'); M.store(num, "-X-GM-LABELS", "\\Inbox"); return True
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
        if find_request(h, reqs) and file_away(M, num): moved += 1
    M.logout(); log(f"tidy: {moved} messages labelled '{LABEL}' and archived"); return moved
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
    """Request ids Anthony has already replied to himself (from Sent Mail), so the job stays out of those threads."""
    done = set()
    try:
        M.select('"[Gmail]/Sent Mail"')
        typ, data = M.search(None, "SUBJECT", '"Re: Request for"')
        for num in (data[0].split() if data and data[0] else []):
            typ, raw = M.fetch(num, "(BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT IN-REPLY-TO REFERENCES MESSAGE-ID)])"); h = email.message_from_bytes(raw[0][1])
            if not h.get("In-Reply-To"): continue          # our own outbound requests are not replies
            if "escp-" in (h.get("In-Reply-To") or ""): continue   # the job's own automated replies
            if "escp-reply-" in (h.get("Message-ID") or ""): continue   # ditto, replies on a district's thread
            r = find_request(h, reqs)
            if not r:
                to = email.utils.parseaddr(h.get("To", ""))[1].lower(); r = next((x for x in reqs if x["to"].lower() == to), None)
            if r: done.add(r["id"])
    except Exception as e: log("sent-mail scan failed", e)
    return done
def inbox():
    reqs = load(); M = imap(); ensure_label(M); mine = anthony_threads(M, reqs)
    for r in reqs:
        if r["id"] in mine and r["status"] in ("sent", "promised", "needs_review"): r["status"] = "anthony_replied"; r["followup_sent_at"] = r.get("followup_sent_at") or "n/a"
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
            handle_one(M, reqs, r, msg, raw[0][1], mid, subject, frm, body, atts, links, quiet=(r["id"] in mine)); handled += 1
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
    first = r.get("body") or (body_for(r) if r.get("kind") in ("policy", "minutes", "research", "state_doe") else "")
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
    for o in r.get("our_messages") or []:
        msgs.append({"who": "us", "date": o.get("at"), "text": o.get("text") or "", "links": []})
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
    why = decision["why"] if decision else "the writer returned nothing usable"
    their_replies = sum(1 for m in thread if m["who"] == "them")
    # The limits code keeps whatever the model chose.
    if move == "ask_minutes" and (record.get("status") == "bans" or their_replies > 1 or r.get("residency_required")):
        move, why = "hold", f"minutes request blocked by rule ({'policy already prohibits' if record.get('status') == 'bans' else 'not a first reply' if their_replies > 1 else 'needs a resident'}); {why}"
    if move == "forward" and not facts.get("redirect_to"):
        move, why = "hold", "forward with no address named; " + why
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
            else: r["status"] = "sent"
        else:
            r["status"] = "needs_review"; entry["action"] = (entry.get("action") or "") + "; reply failed to send"
    else:
        r["status"] = "anthony_replied" if quiet else "needs_review"
        entry["action"] = (entry.get("action") or "") + ("; logged, Anthony is handling this thread" if quiet else f"; held for Anthony: {why}")
        if not quiet:
            m = EmailMessage(); m["From"] = FROM; m["To"] = frm; m["Subject"] = "Re: " + " ".join(str(subject).split())
            m["In-Reply-To"] = mid; m["References"] = mid
            m.set_content((text or "") + f"\n\n\n[HELD — {why}]\n\nThey wrote:\n\n{triage_mod.strip_quoted(body)[:1500]}\n")
            put_draft(M, m)
    finish()

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
