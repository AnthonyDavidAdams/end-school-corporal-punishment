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
def request_body(r):
    silent = "We read the student handbook, which does not mention it. " if r.get("kind") == "handbook silent" else ""
    return f"""Hello,

I'm with EarthPilot's End School Corporal Punishment project, which maintains a public, sourced record of every US district's written policy on corporal punishment (earthpilot.org/kids).

Your district's 2023-24 federal Civil Rights Data Collection filing reports {r['kids']} students receiving corporal punishment, but we have not been able to locate the district's written policy on it — board policy manual, student code of conduct, or handbook. {silent}Could you send the board policy, or a link to where it is published?

Please treat this as a request for a public record under {r.get('statute') or 'your state public records law'}. We record the policy's own wording verbatim with its source. If the district has no written policy on the practice, that is useful to know too — and EarthPilot.org runs a free in-kind grant program (model policy, staff curriculum, implementation coaching) for districts that want one.

Thank you,
Anthony Adams
EarthPilot · earthpilot.org/kids · {USER}
"""
def thanks_body(r, what):
    return f"""Thank you — received. {what} We record the policy's own wording verbatim with its source, and {nice(r['name'])}'s entry at earthpilot.org/kids/state/{r['state']}/ will show it within a day.

If anything in the entry is wrong, reply to this message and it will be corrected.

Anthony Adams
EarthPilot · earthpilot.org/kids
"""
def offer_body(r):
    return f"""Thank you for the straight answer. A district without a written policy on this is more common than people think, and it puts the district in a hard spot: the practice is on the federal record for {nice(r['name'])} ({r['kids']} students in 2023-24), and there is nothing on paper that says who may do it, when, how, or how a parent can decline.

Your district is eligible for the Safe Discipline Program grant: an in-kind grant funded and administered by EarthPilot.org, at no cost to the district and with no cash changing hands. It provides:

- a model board policy, drafted to your state's law and your board's format, in either direction the board chooses: governing the practice with parental consent and limits, or replacing it;
- a replacement discipline curriculum for staff (ten short modules, evidence-cited, built for small schools), which the district may adopt in whole or in part;
- implementation coaching for the superintendent and principals through the first year, including the board presentation and the parent letter.

There is no cost and no obligation. If that is useful, reply and I will send the model policy for {r['state']} and a one-page outline of the program. If the board would rather start with the policy alone, that is fine too.

Anthony Adams
EarthPilot · earthpilot.org/kids · {USER}
"""
def nudge_body(r):
    return f"""Hello — following up on my request of {r['sent_at'][:10]} for {nice(r['name'])}'s written policy on corporal punishment (board policy, code of conduct, or handbook), made under {r.get('statute') or 'your state public records law'}.

A link to where it is published is enough. If the district has no written policy on the practice, a one-line reply saying so closes the request.

Thank you,
Anthony Adams
EarthPilot · earthpilot.org/kids · {USER}
"""

# ---------------------------------------------------------------- send
def send(limit=25):
    reqs = load(); M = imap(); n = 0
    for r in reqs:
        if r["status"] != "pending" or n >= limit: continue
        subject = f"Request for {nice(r['name'])}'s corporal punishment policy"
        mid = f"<escp-{r['id']}@earthpilot.org>"
        m = EmailMessage(); m["From"] = FROM; m["To"] = r["to"]; m["Subject"] = subject; m["Message-ID"] = mid
        m["Date"] = email.utils.formatdate(localtime=True); m["X-ESCP-Request"] = r["id"]; m.set_content(request_body(r))
        try:
            smtp_send(m); r["status"] = "sent"; r["sent_at"] = datetime.datetime.now().isoformat(timespec="seconds"); r["message_id"] = mid; n += 1
            delete_draft(M, subject); log("sent", r["state"], r["name"], "->", r["to"]); save(reqs); time.sleep(8)
        except Exception as e:
            log("SEND FAILED", r["name"], e); r["status"] = "error"; r["error"] = str(e)[:200]; save(reqs)
    M.logout(); log(f"send: {n} sent, {sum(1 for r in reqs if r['status']=='pending')} still pending")

# ---------------------------------------------------------------- inbox
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
    subj = str(make_header(decode_header(msg.get("Subject", "")))).lower(); frm = email.utils.parseaddr(msg.get("From", ""))[1].lower()
    dom = frm.split("@")[-1]
    cands = [r for r in reqs if r["status"] != "pending" and (r["to"].split("@")[-1].lower() == dom or nice(r["name"]).lower() in subj)]
    return cands[0] if len(cands) == 1 else None
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
def inbox():
    reqs = load(); M = imap(); M.select("INBOX")
    since = (datetime.date.today() - datetime.timedelta(days=45)).strftime("%d-%b-%Y")
    typ, data = M.search(None, "SINCE", since); seen = {m for r in reqs for m in [x["message_id"] for x in r["replies"]]}
    handled = 0
    for num in (data[0].split() if data and data[0] else []):
        typ, raw = M.fetch(num, "(BODY.PEEK[])"); msg = email.message_from_bytes(raw[0][1])
        mid = msg.get("Message-ID", "").strip()
        if not mid or mid in seen: continue
        r = find_request(msg, reqs)
        if not r: continue
        subject = str(make_header(decode_header(msg.get("Subject", "")))); frm = email.utils.parseaddr(msg.get("From", ""))[1]
        body, atts = part_text(msg); links = [u for u in re.findall(r"https?://[^\s<>\")\]]+", body) if "earthpilot" not in u]
        d = os.path.join(REPLIES, r["id"]); os.makedirs(d, exist_ok=True); h = hashlib.sha1(mid.encode()).hexdigest()[:8]
        open(os.path.join(d, h + ".eml"), "wb").write(raw[0][1])
        kind, conf = jev_kind(subject, frm, body, atts, links)
        entry = {"message_id": mid, "from": frm, "date": msg.get("Date"), "kind": kind, "confidence": conf, "attachments": [a[0] for a in atts], "links": links[:10], "file": h + ".eml", "action": None}
        log(f"reply from {frm} for {r['state']} {r['name']}: {kind} ({conf})")
        if kind == "auto_reply_or_bounce":
            if re.search(r"delivery|undeliver|failure|not delivered", subject + body[:500], re.I): r["status"] = "bounced"
            entry["action"] = "logged"
        elif kind == "document":
            got = []
            for fn, payload, ct in atts:
                if re.search(r"\.(pdf|docx?|txt)$", fn, re.I) and payload:
                    dd = os.path.join(INBOUND, r["state"]); os.makedirs(dd, exist_ok=True); p = os.path.join(dd, f"{r.get('nces_id') or r['id']}-{re.sub(r'[^A-Za-z0-9._-]', '_', fn)}"); open(p, "wb").write(payload); got.append(file_document(r, p, "attachment"))
            for u in links[:3]:
                try:
                    dd = os.path.join(INBOUND, r["state"]); os.makedirs(dd, exist_ok=True); ext = ".pdf" if ".pdf" in u.lower() else ".html"
                    p = os.path.join(dd, f"{r.get('nces_id') or r['id']}-link-{hashlib.sha1(u.encode()).hexdigest()[:6]}{ext}")
                    subprocess.run(["curl", "-sL", "-m", "60", "-A", "Mozilla/5.0", "-o", p, u], timeout=90)
                    if os.path.getsize(p) > 500: got.append(file_document(r, p, "link: " + u))
                except Exception as e: log("link fetch failed", u, e)
            if not got or all(g is None for g in got):
                # pasted in the body, or nothing we could read: keep it for a person
                if clip(body):
                    dd = os.path.join(INBOUND, r["state"]); os.makedirs(dd, exist_ok=True); p = os.path.join(dd, f"{r.get('nces_id') or r['id']}-email-body.txt"); open(p, "w").write(body); got.append(file_document(r, p, "pasted in the reply"))
            recorded = [g for g in got if g and g != "held"]
            if recorded:
                r["status"] = "answered"; entry["action"] = f"recorded {recorded[0]}"
                m = EmailMessage(); m["From"] = FROM; m["To"] = frm; m["Subject"] = "Re: " + subject; m["In-Reply-To"] = mid; m["References"] = mid; m.set_content(thanks_body(r, "The policy has been read and recorded.")); smtp_send(m); entry["action"] += "; thanked"
            else:
                r["status"] = "needs_review"; entry["action"] = "document kept; held for a person"; text_anthony(f"ESCP: {nice(r['name'])} {r['state']} sent a document the pipeline could not record — see data/outreach/replies/{r['id']}/")
        elif kind == "no_written_policy":
            r["status"] = "no_policy"; entry["action"] = "recorded no-policy; offer sent"
            rec = [{"state": r["state"], "name": r["name"], "nces_id": r.get("nces_id"), "status": "unknown", "notes": f"District states in a reply of {datetime.date.today().isoformat()} to a public records request that it has no written policy on corporal punishment. Reply kept at data/outreach/replies/{r['id']}/{h}.eml."}]
            p = os.path.join(LOGDIR, f"nopolicy-{r['id']}.json"); json.dump(rec, open(p, "w")); subprocess.run(["node", "tools/merge-scan.mjs", p], cwd=ROOT, capture_output=True); publish(f"{nice(r['name'])}, {r['state']}: no written policy, by the district's own account")
            m = EmailMessage(); m["From"] = FROM; m["To"] = frm; m["Subject"] = "Re: " + subject; m["In-Reply-To"] = mid; m["References"] = mid; m.set_content(offer_body(r)); smtp_send(m)
        elif kind == "will_send_later":
            r["status"] = "promised"; r["followup_sent_at"] = None; entry["action"] = "waiting"
        else:
            r["status"] = "needs_review"; entry["action"] = "drafted for Anthony"
            m = EmailMessage(); m["From"] = FROM; m["To"] = frm; m["Subject"] = "Re: " + subject; m["In-Reply-To"] = mid; m["References"] = mid
            m.set_content(f"[DRAFT for Anthony — {kind}, confidence {conf}]\n\nThey wrote:\n\n{body[:1500]}\n\n---\n\nThank you for replying. \n\nAnthony Adams\nEarthPilot · earthpilot.org/kids\n"); put_draft(M, m)
            text_anthony(f"ESCP: {nice(r['name'])} {r['state']} replied ({kind}). A draft is in Gmail Drafts.")
        r["replies"].append(entry); handled += 1; save(reqs)
    M.logout(); log(f"inbox: {handled} new replies handled")

# ---------------------------------------------------------------- follow-up
def followup():
    reqs = load(); n = 0
    for r in reqs:
        if r["status"] in ("sent", "promised") and not r.get("followup_sent_at") and business_days_since(r.get("sent_at")) >= 10:
            m = EmailMessage(); m["From"] = FROM; m["To"] = r["to"]; m["Subject"] = f"Re: Request for {nice(r['name'])}'s corporal punishment policy"
            m["In-Reply-To"] = r["message_id"]; m["References"] = r["message_id"]; m.set_content(nudge_body(r))
            try: smtp_send(m); r["followup_sent_at"] = datetime.datetime.now().isoformat(timespec="seconds"); n += 1; log("nudged", r["state"], r["name"]); time.sleep(8)
            except Exception as e: log("nudge failed", r["name"], e)
    save(reqs); log(f"followup: {n} nudges")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "cycle"
    if cmd == "send": send(int(sys.argv[2]) if len(sys.argv) > 2 else 25)
    elif cmd == "inbox": inbox()
    elif cmd == "followup": followup()
    elif cmd == "cycle": send(25); inbox(); followup()
    elif cmd == "status":
        reqs = load(); from collections import Counter; print(Counter(r["status"] for r in reqs)); [print(" ", r["state"], r["name"], r["status"], [x["kind"] for x in r["replies"]]) for r in reqs if r["replies"]]
