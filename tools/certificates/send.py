#!/usr/bin/env tools/.venv/bin/python
"""Safe School certificates: who gets one, in what order, and the sending.

A district qualifies when its record carries a quoted BOARD POLICY (policy_code on file) with status
"bans". Permitting states first, largest federal enrollment first within a state. Each send is the
cover email, the press release in the body, and the certificate PDF, rendered for that district with
its own sentence, policy code, superintendent and a QR code to its state page. Every send is logged
as a request of kind "certificate" so replies thread into the same pipeline as everything else.

    python3 tools/certificates/send.py --dry            the next batch, nothing sent
    python3 tools/certificates/send.py --limit 150      send the next 150
"""
import re, argparse, datetime, email.utils, hashlib, json, os, re, subprocess, sys
from email.message import EmailMessage
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools/outreach"))
import run, messages  # noqa: E402

OUT = os.path.join(ROOT, "out/certificates/sent"); os.makedirs(OUT, exist_ok=True)
STATE_NAMES = messages.STATE_NAMES
YEAR = "2026–27"


def contacts():
    by_id, by_name = {}, {}
    for f in os.listdir(os.path.join(ROOT, "data/contacts")):
        if not f.endswith(".json"): continue
        d = json.load(open(os.path.join(ROOT, "data/contacts", f)))
        for c in (d if isinstance(d, list) else d.get("contacts") or []):
            if not isinstance(c, dict) or not (c.get("district_email") or c.get("email")): continue
            if c.get("nces_id"): by_id[str(c["nces_id"])] = c
            if c.get("state") and c.get("name"): by_name[(c["state"], re.sub(r"[^a-z0-9]", "", c["name"].lower()))] = c
    return by_id, by_name


def enrollment():
    m = {}
    try:
        for line in open(os.path.join(ROOT, "data/nces/lea-directory-2023-24.csv")).read().split("\n")[1:]:
            c = line.split(",")
            if len(c) > 7:
                try: m[c[0]] = int(c[7] or 0)
                except ValueError: pass
    except Exception: pass
    return m


def candidates(reqs):
    states = json.load(open(os.path.join(ROOT, "site/data/states.json")))
    permitting = {k for k, v in states.items() if v.get("status") in ("legal", "partial")}
    done = {str(r.get("nces_id")) for r in reqs if r.get("kind") == "certificate"}
    by_id, by_name = contacts(); enr = enrollment(); out = []
    for f in sorted(os.listdir(os.path.join(ROOT, "data/districts"))):
        if not f.endswith(".yaml"): continue
        st = f[:2]
        for x in yaml.safe_load(open(os.path.join(ROOT, "data/districts", f)))["districts"]:
            # a board policy on file (policy code), or the policy the superintendent sent us by email
            if x.get("status") != "bans" or not x.get("quote") or not x.get("nces_id") or not (x.get("policy_code") or x.get("method") == "records_request"): continue
            # The quote must be the board's words. A sentence from the superintendent's email ("we do not use it")
            # is not a policy, and a record built from an email needs a policy code before it is certified.
            if "-email-" in str(x.get("source") or "") and not x.get("policy_code"): continue
            if re.search(r"\b(we|our|us|I|I'm|I've|my|me|Anthony|Mr\.? Adams)\b", x["quote"]): continue
            if str(x["nces_id"]) in done: continue
            c = by_id.get(str(x["nces_id"])) or by_name.get((st, re.sub(r"[^a-z0-9]", "", x["name"].lower()))) or {}
            to = c.get("district_email") or c.get("email") or (x.get("contact") or {}).get("district_email")
            if not to or re.search(r"@(gmail|yahoo|hotmail|aol)\.", to, re.I): continue
            out.append({"state": st, "name": x["name"], "nces_id": str(x["nces_id"]), "to": to, "superintendent": c.get("superintendent") or (x.get("contact") or {}).get("superintendent"),
                        "quote": x["quote"], "code": str(x.get("policy_code") or "as sent by the district"), "source": x.get("source"), "permitting": st in permitting, "enrollment": enr.get(str(x["nces_id"]), 0)})
    out.sort(key=lambda d: (not d["permitting"], d["state"], -d["enrollment"], d["name"]))
    return out


def clean_name(n):
    return re.sub(r"\s*\(\d+\)\s*$", "", n).strip()


def tidy_name(s):
    """Directories shout: SENN, JEFF D. becomes Jeff D. Senn."""
    if not s: return s
    s = re.sub(r"^(Dr|Mr|Mrs|Ms|Miss)\.?\s+", "", s.strip())
    if "," in s:
        last, first = [x.strip() for x in s.split(",", 1)]; s = f"{first} {last}"
    if s.isupper(): s = " ".join(w.capitalize() if len(w) > 2 else w.capitalize() for w in s.split())
    return re.sub(r"\s+", " ", s)


def sup_last(s):
    s = tidy_name(s)
    return s.split()[-1] if s else None


def render(d):
    slug = re.sub(r"[^a-z0-9]+", "-", d["name"].lower()).strip("-")
    base = os.path.join(OUT, f"{d['state']}-{slug}")
    qr = base + ".qr.svg"
    import qrcode, qrcode.image.svg
    img = qrcode.make(f"https://earthpilot.org/kids/state/{d['state']}/", image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=0)
    open(qr, "w").write(img.to_string().decode())
    args = ["node", "certificates/make.mjs", "--state", d["state"], "--name", clean_name(d["name"]), "--code", d["code"], "--quote", d["quote"],
            "--url", f"https://earthpilot.org/kids/state/{d['state']}/", "--qr", qr, "--out", base, "--year", YEAR]
    if d.get("superintendent"): args += ["--superintendent", tidy_name(d["superintendent"])]
    r = subprocess.run(args, cwd=os.path.join(ROOT, "tools"), capture_output=True, text=True, timeout=180)
    if r.returncode != 0 or not os.path.exists(base + ".pdf"): raise RuntimeError(r.stderr[-300:])
    return base + ".pdf"


def messages_subject(r):
    try: return run.subject_for(r)
    except Exception: return None
def open_thread(d, reqs):
    """Why a momentum certificate must wait: the thread still has a question of ours in the air (a link, minutes,
    a formal request), a person is reviewing it, or their reply is less than two hours old and the record has
    not had a full cycle to settle. Fifteen certificates went onto open threads before this (Anderson County KY
    was still being asked for the link; Blackford IN got one 25 minutes after the ask)."""
    for r in reqs:
        if r.get("kind") == "certificate" or str(r.get("nces_id")) != d["nces_id"]: continue
        if r.get("status") in ("needs_review", "held", "pending"): return f"{r['status']} ({r['id']})"
        if r.get("status") != "answered" and any(r.get(k) for k in ("awaiting_link_since", "minutes_requested_at", "formal_requested_at", "residency_asked_at", "pending_expanded")): return f"an ask is open ({r['id']})"
        last = r.get("last_reply_at")
        try:
            if last and (datetime.datetime.now() - datetime.datetime.fromisoformat(last[:19])).total_seconds() < 2 * 3600: return f"their reply is under two hours old ({r['id']})"
        except Exception: pass
    return None


def prior(d, reqs):
    """The earlier exchange with this district, if there was one: who answered and what they did."""
    for r in reqs:
        if r.get("kind") == "certificate" or str(r.get("nces_id")) != d["nces_id"]: continue
        theirs = [e for e in r.get("replies") or [] if e.get("from") != "us" and e.get("kind") != "auto_reply_or_bounce"]
        if not theirs: continue
        kinds = [e.get("kind") for e in theirs]
        did = ("sending the policy over" if any(k in ("document_attached", "document") for k in kinds)
               else "sending the link to the policy" if "document_linked" in kinds
               else "pointing us to where it lives on your site" if "website_no_link" in kinds
               else "answering our note about the policy")
        when = (theirs[-1].get("date") or "")[:16]
        frm = (theirs[-1].get("from") or "")
        # greet the person who wrote back; the superintendent's name only when the reply came from their own mailbox
        who = messages.first_name(r.get("superintendent")) if r.get("superintendent") else None
        if frm and r.get("superintendent"):
            toks = [t for t in re.findall(r"[a-z]{3,}", re.sub(r"\b(dr|mr|mrs|ms|jr|sr)\b", " ", r["superintendent"].lower()))]
            if not any(t in frm.lower().split("@")[0] for t in toks):
                who = messages.first_name(theirs[-1].get("name") or theirs[-1].get("from_name") or "") if (theirs[-1].get("name") or theirs[-1].get("from_name")) else messages.first_name(frm.split("@")[0].replace(".", " ").replace("_", " ").split()[0]) if "." in frm.split("@")[0] or "_" in frm.split("@")[0] else "there"
        return {"who": who, "did": did, "when": when, "from": frm, "thread_id": r.get("message_id"), "thread_subject": r.get("subject") or messages_subject(r)}
    return None


def press_release(d):
    """The sample press release, in plain paragraphs; rendered to .docx for the attachment."""
    name = clean_name(d["name"]); st = STATE_NAMES.get(d["state"], d["state"]); yr = YEAR.replace("–", "-")
    return [
        ("h", f"{name} Recognized as a Safe School for {yr}"),
        ("i", "District's written ban on corporal punishment earns recognition from EarthPilot's Safe Schools Project"),
        ("p", f"{name.upper()}, {st} — {name} has been recognized as a Safe School for the {yr} school year by the Safe Schools Project, a public record of every U.S. school district's written policy on corporal punishment."),
        ("p", f"The recognition goes to districts whose board policy prohibits corporal punishment in every school. {name}'s policy {d['code']} states: \"{d['quote']}\""),
        ("p", f"\"{name} put it in writing, and that is what protects children,\" said Anthony David Adams, founder of EarthPilot. \"In the 17 states where paddling is still legal, most districts have not. {name} is on the right side of the line, and the record shows it.\""),
        ("p", "[Optional quote from the superintendent or board president.]"),
        ("p", "The district's policy is in keeping with the American Academy of Pediatrics, which in 2023 called for corporal punishment to be abolished in all school settings; the U.S. Secretary of Education, who asked every state to end the practice in 2023; and the American Psychological Association, the ACLU, the NEA and the NAACP, among more than 100 organizations that signed a 2016 open letter calling for its end. Thirty-three states prohibit it by law."),
        ("p", "According to the federal Civil Rights Data Collection, 19,851 public school students in the United States received corporal punishment in the 2023-24 school year."),
        ("p", "The Safe Schools Project keeps a public, sourced record of each district's own written rule at earthpilot.org/kids. Districts may view their entry and its source document there."),
        ("b", "About EarthPilot"),
        ("p", "EarthPilot builds open projects that point many people and their AI agents at one public problem. The Safe Schools Project is its first: a district-by-district record of corporal punishment policy in U.S. public schools, quoted from each district's own documents."),
        ("b", "Contact"),
        ("p", "Anthony David Adams, EarthPilot · anthony@175g.com · (234) 516-2545"),
    ]


def press_release_docx(d, path):
    import docx
    from docx.shared import Pt
    doc = docx.Document()
    st = doc.styles["Normal"]; st.font.name = "Calibri"; st.font.size = Pt(11)
    doc.add_paragraph("FOR IMMEDIATE RELEASE").runs[0].bold = True
    for kind, text in press_release(d):
        if kind == "h": doc.add_heading(text, level=1)
        elif kind == "i": r = doc.add_paragraph().add_run(text); r.italic = True
        elif kind == "b": r = doc.add_paragraph().add_run(text); r.bold = True
        else: doc.add_paragraph(text)
    doc.save(path); return path


ago = messages.ago


def in_thread_cover(d, p):
    """The certificate as the next message in a conversation the district is already having with us: three
    short paragraphs in Anthony's phone voice, no research bullets, no 'Dear Superintendent'. Sixty-three
    districts got a one-line iPhone reply and then, hours later in the same thread, a four-hundred-word
    letter with four bullets; this is the fix. The formal cover stays for cold sends."""
    name = clean_name(d["name"]); yr = YEAR.replace("–", "-"); who = p.get("who") or "there"
    if who.lower() in ("superintendent",): who = "there"
    code = d["code"]; cited = f"policy {code}" if code and code != "as sent by the district" else "the board's own policy"
    paras = [
        f"Hey {who}, thanks for {p['did']} {ago(p.get('when'))}. With {cited} in writing, {name} goes on the Safe Schools list, and the certificate for the {yr} school year is attached, print-ready, with the policy's own sentence on it and a QR code to the district's entry at earthpilot.org/kids. Hang it if you like.",
        "There's also a short press release attached as a Word file, written so your office can send it to the local paper with one edit, in case you want the good version of the story out first.",
        "One ask, only if you're willing: a thirty-second phone video from you or a principal on what the district does instead. No script. earthpilot.org/kids/video",
        messages.sig(run.USER),
    ]
    import html as H
    plain = "\n\n".join(paras) + "\n"
    html_doc = "<html><body style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:#111\">" + "".join(f"<p>{H.escape(t).replace(chr(10), '<br>')}</p>" for t in paras) + "</body></html>"
    return plain, html_doc


def cover(d, reqs=None):
    """The cover email, as (plain text, html). Bold in the html marks the sentence fragments and figures
    a busy reader should catch; the plain part reads the same without it."""
    name = clean_name(d["name"]); st = STATE_NAMES.get(d["state"], d["state"]); last = sup_last(d.get("superintendent")); yr = YEAR.replace("–", "-")
    p = prior(d, reqs or [])
    if p:
        return in_thread_cover(d, p)
    if False:
        pass
    else:
        greet = f"Dear Superintendent {last}," if last else "Dear Superintendent,"
        lead = "Congratulations. "
    # paragraphs as (text with **bold** marks); rendered two ways below
    paras = [
        lead + f"{name} has a written board policy that **prohibits corporal punishment in every school it governs**. Not every district in {st} can say that, and in the 17 states where the practice is still legal, most cannot. We are recognizing {name} with a **Safe School certificate for the {yr} school year**.",
        f"It's attached as a print-ready PDF featuring your policy's own sentence, **\"{d['quote']}\"** (policy {d['code']}), and a QR code to the district's entry in the public record at earthpilot.org/kids, where anyone can see the source.",
        "Your policy stands with:",
        "LIST:" + "||".join([
            "**The American Academy of Pediatrics**, which in 2023 called for corporal punishment to be abolished in all school settings in every state, and whose 2018 discipline guidance found all forms of it minimally effective in the short term and harmful over time.",
            "**The U.S. Secretary of Education**, who wrote to every governor and state education chief in March 2023 asking them to end it.",
            "**The American Psychological Association, the ACLU, the NEA, the NAACP** and more than 100 other organizations, in a 2016 open letter calling for an end to the practice in schools.",
            "**The American Academy of Child and Adolescent Psychiatry** (2012), **the National Association of School Psychologists** (2021) and **the National PTA**, each on record against it.",
        ]),
        "What the research says, briefly: a 2022 meta-analysis of school corporal punishment specifically, across **21 studies and more than 67,000 children**, found it associated with **more aggressive and disruptive behavior, more anxiety and depression, and lower school performance**. A 2019 study of young adults from the states where it was legal found that those who had received it in school had **lower high school GPAs and more depressive symptoms**. The 2016 review of 75 studies and 160,927 children found physical punishment linked to **13 of 17 outcomes studied, every one in the direction of harm**.",
        f"Nationally, **19,851 public school students were struck as punishment in 2023-24**, down from 106,055 a decade earlier. Districts like yours are why.",
        "Two things you are welcome to do with this: hang it, and tell people. A sample press release is attached as a Word document, written so your office can send it to local media with one edit.",
        "One more, if you are willing. We are collecting **thirty-second selfie videos** from superintendents, principals and teachers in districts that chose other approaches: what you do instead, what changed, or what you would tell a district that still paddles. No script, phone in hand. Send one at earthpilot.org/kids/video/ and we will put a real face to this.",
        "With respect and thanks,",
        "Anthony David Adams\nFounder, EarthPilot · Safe Schools Project\nearthpilot.org/kids · anthony@175g.com",
    ]
    import html as H
    def plain(t): return t.replace("**", "")
    def rich(t):
        t = H.escape(t); t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
        return re.sub(r"(earthpilot\.org/kids(?:/video/)?)", r'<a href="https://\1" style="color:#0D132D">\1</a>', t).replace("\n", "<br>")
    text_parts, html_parts = [greet], [f"<p>{H.escape(greet)}</p>"]
    for t in paras:
        if t.startswith("LIST:"):
            items = t[5:].split("||")
            text_parts.append("\n".join("  - " + plain(i) for i in items)); html_parts.append("<ul style='margin:0 0 14px 18px;padding:0'>" + "".join(f"<li style='margin:0 0 6px'>{rich(i)}</li>" for i in items) + "</ul>")
        else:
            text_parts.append(plain(t)); html_parts.append(f"<p style='margin:0 0 14px'>{rich(t)}</p>")
    text = "\n\n".join(text_parts) + "\n"
    html_doc = f"""<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff"><div style="max-width:620px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0D132D">{''.join(html_parts)}</div></body></html>"""
    return text, html_doc


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry", action="store_true"); ap.add_argument("--limit", type=int, default=150); ap.add_argument("--state"); ap.add_argument("--test", help="send the first district's package to this address instead; nothing is logged")
    ap.add_argument("--momentum", action="store_true", help="only districts whose superintendent has written to us (they sent the policy): keep the momentum, certificate the same day"); a = ap.parse_args()
    reqs = run.load(); cands = candidates(reqs)
    if a.state: cands = [c for c in cands if c["state"] == a.state]
    if a.momentum:
        cands = [c for c in cands if prior(c, reqs) and not open_thread(c, reqs)]
        cands.sort(key=lambda c: (prior(c, reqs) or {}).get("when") or "", reverse=True)
    batch = cands[:a.limit]
    if a.test:
        d = batch[0]; pdf = render(d); subject = f"[TEST] {clean_name(d['name'])} recognized as a Safe School for {YEAR.replace('–', '-')}"
        m = EmailMessage(); m["From"] = run.FROM; m["To"] = a.test; m["Subject"] = subject; m["Date"] = email.utils.formatdate(localtime=True); m["Message-ID"] = f"<escp-cert-test-{datetime.datetime.now().strftime('%H%M%S')}@earthpilot.org>"
        body, html_doc = cover(d, reqs); m.set_content(body); m.add_alternative(html_doc, subtype="html")
        m.add_attachment(open(pdf, "rb").read(), maintype="application", subtype="pdf", filename=f"Safe School {YEAR.replace('–', '-')} - {clean_name(d['name'])}.pdf")
        docx_path = press_release_docx(d, pdf[:-4] + "-press-release.docx")
        m.add_attachment(open(docx_path, "rb").read(), maintype="application", subtype="vnd.openxmlformats-officedocument.wordprocessingml.document", filename=f"Press release - {clean_name(d['name'])} Safe School {YEAR.replace('–', '-')}.docx")
        run.smtp_send(m); print("test sent to", a.test, "for", clean_name(d["name"]), "| would have gone to", d["to"]); return
    print(f"qualifying with an address: {len(cands)} · this batch: {len(batch)}")
    if a.dry:
        for d in batch: print(f"  {d['state']}  {clean_name(d['name'])[:40]:<40}  {d['code']:<8}  {(d.get('superintendent') or '')[:26]:<26}  {d['to']:<40}  {'(prior exchange)' if prior(d, reqs) else ''}")
        return
    sent = 0
    for d in batch:
        try:
            pdf = render(d)
        except Exception as ex:
            print("render failed", d["name"], str(ex)[:120]); continue
        rid = hashlib.sha1(f"certificate|{d['state']}|{d['nces_id']}".encode()).hexdigest()[:10]
        subject = f"{clean_name(d['name'])} recognized as a Safe School for {YEAR.replace('–', '-')}"
        pr = prior(d, reqs) if a.momentum else None
        if pr and pr.get("thread_id") and pr.get("thread_subject"):
            # keep the certificate in the conversation the district already has with us
            subject = "Re: " + pr["thread_subject"]
        m = EmailMessage(); m["From"] = run.FROM; m["To"] = d["to"]; m["Subject"] = subject
        if pr and pr.get("thread_id"): m["In-Reply-To"] = pr["thread_id"]; m["References"] = pr["thread_id"]
        m["Date"] = email.utils.formatdate(localtime=True); m["Message-ID"] = f"<escp-{rid}@earthpilot.org>"; m["X-ESCP-Request"] = rid
        body, html_doc = cover(d, reqs); m.set_content(body); m.add_alternative(html_doc, subtype="html")
        m.add_attachment(open(pdf, "rb").read(), maintype="application", subtype="pdf", filename=f"Safe School {YEAR.replace('–', '-')} - {clean_name(d['name'])}.pdf")
        docx_path = press_release_docx(d, pdf[:-4] + "-press-release.docx")
        m.add_attachment(open(docx_path, "rb").read(), maintype="application", subtype="vnd.openxmlformats-officedocument.wordprocessingml.document", filename=f"Press release - {clean_name(d['name'])} Safe School {YEAR.replace('–', '-')}.docx")
        try:
            run.smtp_send(m)
        except Exception as ex:
            print("SEND FAILED", d["name"], str(ex)[:120]); continue
        reqs.append({"id": rid, "kind": "certificate", "state": d["state"], "name": d["name"], "nces_id": d["nces_id"], "kids": None, "to": d["to"], "superintendent": d.get("superintendent"),
                     "status": "sent", "sent_at": datetime.datetime.now().isoformat(timespec="seconds"), "message_id": m["Message-ID"], "subject": subject, "body": body, "replies": [], "followup_sent_at": "n/a",
                     "certificate_pdf": os.path.relpath(pdf, ROOT), "notes": f"Safe School certificate {YEAR}; board policy {d['code']}."})
        run.save(reqs); sent += 1; print("sent", d["state"], clean_name(d["name"]), "->", d["to"])
        import time; time.sleep(6)
    print(f"certificates sent: {sent}")


if __name__ == "__main__":
    main()
