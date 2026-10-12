#!/usr/bin/env tools/.venv/bin/python
"""Safe Schools State certificates: one per state that prohibits corporal punishment in public schools
by law, emailed to the governor's press office with the state education chief copied.

    tools/.venv/bin/python tools/certificates/governors.py --dry          who would get one, and from which address
    tools/.venv/bin/python tools/certificates/governors.py --test EMAIL   one full package to EMAIL, nothing logged
    tools/.venv/bin/python tools/certificates/governors.py --send         send them all
"""
import argparse, datetime, email.utils, hashlib, json, os, re, subprocess, sys
from email.message import EmailMessage
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools/outreach")); sys.path.insert(0, os.path.join(ROOT, "tools/certificates"))
import run  # noqa: E402
import send as district  # noqa: E402

OUT = os.path.join(ROOT, "out/certificates/states"); os.makedirs(OUT, exist_ok=True)
YEAR = district.YEAR
NAMES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "the District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}


def states():
    g = json.load(open(os.path.join(ROOT, "data/states/governors.json")))["states"]
    out = []
    for f in sorted(os.listdir(os.path.join(ROOT, "data/states"))):
        if not f.endswith(".yaml"): continue
        s = yaml.safe_load(open(os.path.join(ROOT, "data/states", f)))
        if s.get("status") != "banned" or not s.get("statute_quote"): continue
        code = s["code"]; gv = (g.get(code) or {}).get("governor") or {}; ch = (g.get(code) or {}).get("education_chief") or {}
        out.append({"state": code, "name": NAMES.get(code, s.get("name")), "year": s.get("year_banned"), "statute": s.get("statute"), "statute_url": s.get("statute_url"), "quote": s["statute_quote"],
                    "governor": gv.get("name"), "gov_title": gv.get("title") or "Governor", "to": gv.get("press_email"), "contact_url": gv.get("contact_url"),
                    "chief": ch.get("name"), "chief_title": ch.get("title"), "cc": ch.get("press_email") or ch.get("records_email")})
    return out


def render(st):
    import qrcode, qrcode.image.svg
    base = os.path.join(OUT, st["state"].lower()); qr = base + ".qr.svg"
    img = qrcode.make(f"https://earthpilot.org/kids/state/{st['state']}/", image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=0); open(qr, "w").write(img.to_string().decode())
    args = ["node", "certificates/make.mjs", "--level", "state", "--state", st["state"], "--name", st["name"], "--code", st["statute"] or "", "--quote", st["quote"], "--url", f"https://earthpilot.org/kids/state/{st['state']}/", "--qr", qr, "--out", base, "--year", YEAR]
    if st.get("governor"): args += ["--governor", st["governor"]]
    if st.get("year"): args += ["--since", str(st["year"])]
    r = subprocess.run(args, cwd=os.path.join(ROOT, "tools"), capture_output=True, text=True, timeout=180)
    if r.returncode != 0 or not os.path.exists(base + ".pdf"): raise RuntimeError(r.stderr[-300:])
    return base + ".pdf"


def press_release(st):
    yr = YEAR.replace("–", "-"); n = st["name"]; N = n if n.startswith("the ") else n
    return [
        ("h", f"{N[0].upper() + N[1:]} Recognized as a Safe Schools State for {yr}"),
        ("i", "State law prohibiting corporal punishment in public schools earns recognition from EarthPilot's Safe Schools Project"),
        ("p", f"{N[0].upper() + N[1:]} has been recognized as a Safe Schools State for the {yr} school year by the Safe Schools Project, a public record of corporal punishment law and policy in every U.S. state and school district."),
        ("p", f"The recognition goes to the 33 states, and the District of Columbia, whose law prohibits corporal punishment in every public school. {N[0].upper() + N[1:]}'s law ({st['statute']}) states: \"{st['quote']}\"" + (f" It has been in force since {st['year']}." if st.get("year") else "")),
        ("p", f"\"Seventeen states still let a school employee hit a child as punishment, and more than a thousand districts in those states still write it into policy,\" said Anthony David Adams, founder of EarthPilot. \"{N[0].upper() + N[1:]} settled this in law. That is the standard, and the record shows which states have met it.\""),
        ("p", f"[Optional quote from {st['gov_title']} {st['governor']}.]" if st.get("governor") else "[Optional quote from the Governor.]"),
        ("p", "The state's law is in keeping with the American Academy of Pediatrics, which in 2023 called for corporal punishment to be abolished in all school settings; the U.S. Secretary of Education, who asked every state to end the practice in 2023; and the American Psychological Association, the ACLU, the NEA and the NAACP, among more than 100 organizations that signed a 2016 open letter calling for its end."),
        ("p", "According to the federal Civil Rights Data Collection, 19,851 public school students in the United States received corporal punishment in the 2023-24 school year, down from 106,055 a decade earlier."),
        ("p", "The Safe Schools Project keeps a public, sourced record of each state's law and each district's own written rule at earthpilot.org/kids."),
        ("b", "About EarthPilot"),
        ("p", "EarthPilot builds open projects that point many people and their AI agents at one public problem. The Safe Schools Project is its first: a state-by-state and district-by-district record of corporal punishment law and policy in U.S. public schools, quoted from the primary sources."),
        ("b", "Contact"),
        ("p", "Anthony David Adams, EarthPilot · anthony@175g.com · (234) 516-2545"),
    ]


def press_release_docx(st, path):
    import docx
    from docx.shared import Pt
    doc = docx.Document(); doc.styles["Normal"].font.name = "Calibri"; doc.styles["Normal"].font.size = Pt(11)
    doc.add_paragraph("FOR IMMEDIATE RELEASE").runs[0].bold = True
    for kind, text in press_release(st):
        if kind == "h": doc.add_heading(text, level=1)
        elif kind == "i": doc.add_paragraph().add_run(text).italic = True
        elif kind == "b": doc.add_paragraph().add_run(text).bold = True
        else: doc.add_paragraph(text)
    doc.save(path); return path


def cover(st, to_chief=False):
    yr = YEAR.replace("–", "-"); n = st["name"]; N = n[0].upper() + n[1:]
    if to_chief and st.get("chief"):
        title = (st.get("chief_title") or "").split(" of ")[0].replace("State ", "") or "Commissioner"
        greet = f"Dear {title} {st['chief'].split()[-1]},"
    else:
        greet = f"Dear {st['gov_title']} {st['governor'].split()[-1]}," if st.get("governor") else "Dear Governor,"
    since = f" It has stood since {st['year']}." if st.get("year") else ""
    paras = [
        f"Congratulations. {N} is one of the 33 states, with the District of Columbia, whose law **prohibits corporal punishment in every public school**.{since} Seventeen states still permit it, and in those states more than a thousand districts still write it into policy. We are recognizing {N} as a **Safe Schools State for the {yr} school year**.",
        f"The certificate is attached as a print-ready PDF featuring the law's own sentence, **\"{st['quote']}\"** ({st['statute']}), and a QR code to the state's entry in the public record at earthpilot.org/kids, where anyone can read the source.",
        "The law stands with:",
        "LIST:" + "||".join([
            "**The American Academy of Pediatrics**, which in 2023 called for corporal punishment to be abolished in all school settings in every state, and whose 2018 discipline guidance found all forms of it minimally effective in the short term and harmful over time.",
            "**The U.S. Secretary of Education**, who wrote to every governor and state education chief in March 2023 asking them to end it.",
            "**The American Psychological Association, the ACLU, the NEA, the NAACP** and more than 100 other organizations, in a 2016 open letter calling for an end to the practice in schools.",
            "**The American Academy of Child and Adolescent Psychiatry** (2012), **the National Association of School Psychologists** (2021) and **the National PTA**, each on record against it.",
        ]),
        "What the research says, briefly: a 2022 meta-analysis of school corporal punishment specifically, across **21 studies and more than 67,000 children**, found it associated with **more aggressive and disruptive behavior, more anxiety and depression, and lower school performance**. The 2016 review of 75 studies and 160,927 children found physical punishment linked to **13 of 17 outcomes studied, every one in the direction of harm**.",
        "Nationally, **19,851 public school students were struck as punishment in 2023-24**, down from 106,055 a decade earlier. States that settled it in law are why.",
        "You are welcome to share this however you like. A sample press release is attached as a Word document, written so your office can send it with one edit." + (f" The certificate is made out to {st['gov_title']} {st['governor']}; the Governor's office publishes no press address, so it comes to you, and we would be grateful if you passed it along." if to_chief and st.get("governor") else (f" We are sending a copy to {st['chief_title']} {st['chief']}." if st.get("chief") and st.get("cc") else "")),
        "One more, if you are willing. We are collecting **thirty-second videos** from leaders in states and districts that chose other approaches: what changed, and what you would say to a state that still permits it. Phone in hand, no script. Send one at earthpilot.org/kids/video/ and we will put a real face to this.",
        "With respect and thanks,",
        "Anthony David Adams\nFounder, EarthPilot · Safe Schools Project\nearthpilot.org/kids · anthony@175g.com · (234) 516-2545",
    ]
    import html as H
    plain = lambda t: t.replace("**", "")
    def rich(t):
        t = H.escape(t); t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
        return re.sub(r"(earthpilot\.org/kids(?:/video/)?)", r'<a href="https://\1" style="color:#0D132D">\1</a>', t).replace("\n", "<br>")
    tp, hp = [greet], [f"<p>{H.escape(greet)}</p>"]
    for t in paras:
        if t.startswith("LIST:"):
            items = t[5:].split("||"); tp.append("\n".join("  - " + plain(i) for i in items)); hp.append("<ul style='margin:0 0 14px 18px;padding:0'>" + "".join(f"<li style='margin:0 0 6px'>{rich(i)}</li>" for i in items) + "</ul>")
        else:
            tp.append(plain(t)); hp.append(f"<p style='margin:0 0 14px'>{rich(t)}</p>")
    return "\n\n".join(tp) + "\n", f"""<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff"><div style="max-width:620px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0D132D">{''.join(hp)}</div></body></html>"""


def package(st, to, cc=None, test=False, to_chief=False):
    pdf = render(st); docx = press_release_docx(st, pdf[:-4] + "-press-release.docx"); yr = YEAR.replace("–", "-")
    subject = ("[TEST] " if test else "") + f"{st['name'][0].upper() + st['name'][1:]} recognized as a Safe Schools State for {yr}"
    m = EmailMessage(); m["From"] = run.FROM; m["To"] = to
    if cc and not test: m["Cc"] = cc
    m["Subject"] = subject; m["Date"] = email.utils.formatdate(localtime=True)
    rid = hashlib.sha1(f"certificate_state|{st['state']}".encode()).hexdigest()[:10]; m["Message-ID"] = f"<escp-{rid}{'-test' if test else ''}@earthpilot.org>"; m["X-ESCP-Request"] = rid
    text, html_doc = cover(st, to_chief); m.set_content(text); m.add_alternative(html_doc, subtype="html")
    m.add_attachment(open(pdf, "rb").read(), maintype="application", subtype="pdf", filename=f"Safe Schools State {yr} - {st['name'][0].upper() + st['name'][1:]}.pdf")
    m.add_attachment(open(docx, "rb").read(), maintype="application", subtype="vnd.openxmlformats-officedocument.wordprocessingml.document", filename=f"Press release - {st['name'][0].upper() + st['name'][1:]} Safe Schools State {yr}.docx")
    return m, rid, subject, text, pdf


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry", action="store_true"); ap.add_argument("--test"); ap.add_argument("--send", action="store_true"); ap.add_argument("--state"); a = ap.parse_args()
    sts = states()
    if a.state: sts = [s for s in sts if s["state"] == a.state]
    reqs = run.load(); done = {r["state"] for r in reqs if r.get("kind") == "certificate_state"}
    if a.dry or not (a.test or a.send):
        for s in sts: print(f"  {s['state']}  {(s['governor'] or '?')[:24]:<24}  {(s['to'] or 'NO PRESS EMAIL: ' + (s['contact_url'] or ''))[:48]:<48}  cc {(s['cc'] or '-')[:34]:<34}  {'(sent)' if s['state'] in done else ''}")
        print(f"{len(sts)} states · {sum(1 for s in sts if s['to'])} with a press email · {sum(1 for s in sts if s['cc'])} with a chief to copy"); return
    if a.test:
        st = next((s for s in sts if s["state"] == (a.state or "CO")), sts[0]); m, *_ = package(st, a.test, test=True); run.smtp_send(m); print("test sent to", a.test, "for", st["name"]); return
    sent = 0
    for st in sts:
        if st["state"] in done: continue
        to_chief = not st["to"]; to = st["to"] or st.get("cc")
        if not to: print("skipped", st["state"], "no address at all"); continue
        try:
            m, rid, subject, text, pdf = package(st, to, None if to_chief else st.get("cc"), to_chief=to_chief); run.smtp_send(m)
        except Exception as ex:
            print("failed", st["state"], str(ex)[:120]); continue
        reqs.append({"id": rid, "kind": "certificate_state", "state": st["state"], "name": f"{st['name']} (Governor {st['governor']})", "nces_id": None, "kids": None, "to": to, "cc": None if to_chief else st.get("cc"), "via_chief": to_chief, "superintendent": st.get("governor"),
                     "status": "sent", "sent_at": datetime.datetime.now().isoformat(timespec="seconds"), "message_id": m["Message-ID"], "subject": subject, "body": text, "replies": [], "followup_sent_at": "n/a", "certificate_pdf": os.path.relpath(pdf, ROOT), "notes": f"Safe Schools State certificate {YEAR}; {st['statute']}."})
        run.save(reqs); sent += 1; print("sent", st["state"], "->", to, "cc", (None if to_chief else st.get("cc")) or "-", "(via the education chief)" if to_chief else "")
        import time; time.sleep(6)
    print("state certificates sent:", sent)


if __name__ == "__main__":
    main()
