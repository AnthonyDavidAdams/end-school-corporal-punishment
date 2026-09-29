"""What a reply actually is, in enough detail to answer it.

The first taxonomy had seven buckets and three of them were doing all the work. "It's on our website"
and "send me your driver's licence" both landed in question_or_pushback, so both became a draft for a
person, and a person had to read twenty-eight emails to find out that eighteen of them needed one of
two form answers. These are the buckets that actually exist in the mail, and each one has a move.

Judgment is Jev's: a choice over a fixed list, with the sentence in front of it. Extraction is code's:
an address is a regular expression, not an inference. Nothing here writes to the record or sends mail.
"""
import json, os, re, urllib.request

KINDS = {
    "document_attached": "The policy, handbook or board manual is attached to the message as a file.",
    "document_linked": "The message contains a URL that points at the policy, the handbook, or the board policy manual itself.",
    "website_no_link": "It says the policy is on the district's website, in the handbook, or under a named section, but gives no usable link or attachment.",
    "residency_required": "It asks for proof that the requester is a resident (or a business) of the state, or says the state's records law only covers residents.",
    "wrong_contact": "It says this mailbox is not monitored, or that someone else handles this, and names or addresses that person.",
    "no_written_policy": "It says the district has no written policy on corporal punishment, or that nothing addresses it in writing.",
    "claims_no_practice": "It says the district does not use corporal punishment, or no longer does, without pointing to a written policy.",
    "will_send_later": "It acknowledges the request and says it is being handled or will be answered later; nothing is sent yet.",
    "refusal_or_fee": "It refuses, cites an exemption, or demands a fee or an in-person visit before releasing anything.",
    "question": "It asks a question about who we are, what we want, or why, and is waiting on an answer before doing anything.",
    "auto_reply_or_bounce": "An out-of-office, an automated acknowledgement, or a delivery failure notice.",
    "other": "None of the above.",
}

ADDR = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PROOF = re.compile(
    r"(driver'?s?\s*licen[cs]e|state\s*(?:issued\s*)?id(?:entification)?(?:\s*card)?|voter\s*registration|"
    r"utility\s*bill|proof\s*of\s*(?:arkansas\s*)?residency|proof\s*of\s*(?:business|arkansas business)\s*operations?|"
    r"documentation\s*of\s*\w+\s*residency|tax\s*(?:bill|statement)|\blease\b|\bdeed\b)", re.I)


def jev_key():
    p = os.path.expanduser("~/personality-bench/.env.local")
    if os.path.exists(p):
        for l in open(p):
            if l.startswith("OPENROUTER"):
                return l.split("=", 1)[1].strip().strip('"')
    return os.environ.get("OPENROUTER_API_KEY")


def jev(state, questions, timeout=60):
    req = urllib.request.Request(
        "https://openrouter.ai/api/alpha/decisions",
        data=json.dumps({"model": "typesafe/jev-1.13", "state": state, "questions": questions}).encode(),
        headers={"Authorization": f"Bearer {jev_key()}", "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=timeout))["answers"]


def strip_quoted(body):
    """Only what they wrote, not our own request quoted back at us."""
    t = re.split(r"\n\s*(On .{5,90}wrote:|From: .{0,80}Anthony|-{3,}\s*Original Message|_{10,})", str(body or ""))[0]
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def triage(subject, frm, body, attachments, links):
    """(kind, confidence, facts) — facts carries what code could extract rather than infer."""
    clean = strip_quoted(body)
    facts = {}

    # Extraction first: these are not judgments and should not be asked of a model.
    doc_links = [u for u in links if re.search(r"\.(pdf|docx?)(\?|$)", u, re.I)
                 or re.search(r"(polic|handbook|conduct|manual|boarddocs|simbli|docs\.google|drive\.google|boardontrack)", u, re.I)]
    if doc_links:
        facts["document_links"] = doc_links[:5]
    doc_atts = [a for a in (attachments or []) if re.search(r"\.(pdf|docx?|txt)$", str(a), re.I)]
    if doc_atts:
        facts["document_attachments"] = doc_atts
    proof = sorted({m.group(0).lower() for m in PROOF.finditer(clean)})
    if proof:
        facts["proof_mentioned"] = proof
    others = [a.lower() for a in ADDR.findall(clean)
              if a.lower() != str(frm).lower() and "earthpilot" not in a.lower() and "175g" not in a.lower()]
    if others:
        facts["addresses_named"] = others[:3]

    q = {"kind": {"type": "choice",
                  "instructions": "What is this reply to a request for a school district's written policy on corporal punishment? "
                                  "Pick by what the sender has actually done, not what they intend. If a document is attached, that wins. "
                                  "If a link to the document itself is present, that wins over a description of where it lives.",
                  "criteria": KINDS}}
    state = {"subject": subject, "from": frm, "body": clean[:2500],
             "attachments": [str(a) for a in (attachments or [])][:6], "links": links[:8]}
    try:
        a = jev(state, q)["kind"]
        kind, conf = a.get("choice", "other"), a.get("confidence", 0)
    except Exception:
        kind, conf = "other", 0.0

    # Two guard rails, because the extraction is certain and the judgment is not.
    if doc_atts and kind not in ("auto_reply_or_bounce",):
        kind, conf = "document_attached", max(conf, 0.95)
    elif doc_links and kind in ("website_no_link", "other", "question"):
        kind, conf = "document_linked", max(conf, 0.9)

    # Residency and a link are not exclusive: Gurdon sent both. Record the residency demand either way,
    # so the exchange knows this district will need a proxy the next time we ask it anything.
    if kind != "auto_reply_or_bounce" and re.search(r"\bresiden|\bcitizen of the state|only.{0,30}residents\b", clean, re.I):
        facts["residency_required"] = True
        if proof:
            facts["residency_proof_accepted"] = ", ".join(proof)

    if re.search(r"(no longer|do not|don'?t|does not)\s+(practice|use|administer|allow|permit)", clean, re.I) \
            and not re.search(r"corporal punishment (is|shall be) (permitted|allowed)", clean, re.I):
        facts["claims_no_practice"] = True

    if re.search(r"unmonitored|not monitored|no longer (with|at) the district|please (contact|reach out to|direct)", clean, re.I) and others:
        facts["redirect_to"] = others[0]

    return kind, conf, facts


if __name__ == "__main__":
    import email, glob, sys
    ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    for f in sorted(glob.glob(os.path.join(ROOT, "data/outreach/replies/*/*.eml")))[: int(sys.argv[1]) if len(sys.argv) > 1 else 99]:
        m = email.message_from_file(open(f, errors="ignore"))
        body = ""
        if m.is_multipart():
            for p in m.walk():
                if p.get_content_type() == "text/plain":
                    body = (p.get_payload(decode=True) or b"").decode("utf8", "ignore")
                    break
        else:
            body = (m.get_payload(decode=True) or b"").decode("utf8", "ignore")
        frm = email.utils.parseaddr(m.get("From", ""))[1]
        links = re.findall(r"https?://[^\s<>\")\]]+", body)
        atts = [p.get_filename() for p in m.walk() if p.get_filename()]
        k, c, facts = triage(m.get("Subject", ""), frm, body, atts, links)
        print(f"{k:<20} {c:>4}  {frm[:34]:<34} {json.dumps(facts)[:110]}")
