"""The cover letter for a Safe School certificate, written for the one district it goes to.

The old cover was the same four hundred words for every district with the name swapped in. Anthony,
2026-11-02: "customize the emails as you can so they aren't just canned." So each cover now opens
with two or three paragraphs written from a fact sheet about that district and nothing else: its own
policy sentence and code, when the board last revised it, where it is kept, how many children it
covers, what the federal data shows for the district, how the rest of its county and state stand, and
any earlier exchange with us. The model may use only those facts; every number in the draft is checked
against the sheet, and a draft that fails twice gives way to the plain template. The closing (press
release, the video ask, the signature) is fixed text.

    python3 tools/certificates/cover.py --nces 4807590      print the fact sheet and a draft
"""
import csv, datetime, glob, hashlib, json, os, re, sys, urllib.request
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools/outreach"))
import writer, messages  # noqa: E402

_T = {}
def tables():
    if _T: return _T
    enr = {}
    for row in csv.DictReader(open(os.path.join(ROOT, "data/nces/lea-enrollment-2023-24.csv"))):
        try: enr[row["nces_id"]] = int(row["enrollment"])
        except ValueError: pass
    crdc = {row["nces_id"]: int(row["students"]) for row in csv.DictReader(open(os.path.join(ROOT, "data/crdc/2023-24/districts.csv")))}
    crdc_state = {row["state"]: row for row in csv.DictReader(open(os.path.join(ROOT, "data/crdc/2023-24/states.csv")))}
    states = json.load(open(os.path.join(ROOT, "site/data/states.json")))
    recs = {}
    for f in glob.glob(os.path.join(ROOT, "data/districts/[A-Z][A-Z].yaml")):
        recs[os.path.basename(f)[:2]] = yaml.safe_load(open(f)).get("districts") or []
    _T.update(enrollment=enr, crdc=crdc, crdc_state=crdc_state, states=states, records=recs)
    return _T

PERMITS = ("allows", "consent_required")
def vendor_of(url):
    u = (url or "").lower()
    for k, v in (("pol.tasb.org", "TASB Policy Online"), ("ksba.org", "the KSBA policy portal"), ("simbli", "Simbli"), ("boarddocs", "BoardDocs"),
                 ("moconed", "the MSBA policy service"), ("kasb", "the KASB policy portal"), ("tsba", "the TSBA policy portal"), ("raw.githubusercontent.com", "the copy the district sent us")):
        if k in u: return v
    return None

def facts(d, prior=None):
    """What is true about this district, for the writer. Nothing goes in that is not on the record."""
    T = tables(); st = d["state"]; recs = T["records"].get(st, [])
    me = next((x for x in recs if str(x.get("nces_id")) == str(d["nces_id"])), {})
    county = me.get("county")
    peers = [x for x in recs if county and x.get("county") == county and str(x.get("nces_id")) != str(d["nces_id"])]
    s = T["states"].get(st, {})
    f = {
        "district": d["name"], "state": messages.STATE_NAMES.get(st, st),
        "superintendent": d.get("superintendent"),
        "policy_code": d["code"], "policy_sentence": d["quote"],
        "policy_last_revised": str(me["policy_revised"]) if me.get("policy_revised") else None, "policy_kept_at": vendor_of(d.get("source")),
        "enrollment_2023_24": T["enrollment"].get(str(d["nces_id"])),
        "district_students_paddled_2023_24_federal_data": T["crdc"].get(str(d["nces_id"]), "none recorded"),
        "state_law": "state law still permits corporal punishment in public schools" if s.get("status") in ("legal", "partial") else "state law prohibits it",
        "state_districts_on_record": len(recs),
        "state_districts_with_written_ban": sum(1 for x in recs if x.get("status") == "bans"),
        "state_districts_still_permitting_on_paper": sum(1 for x in recs if x.get("status") in PERMITS),
        "state_students_paddled_2023_24_federal_data": int(T["crdc_state"][st]["students"]) if st in T["crdc_state"] else None,
        "county": county,
        "county_other_districts": len(peers) if county else None,
        "county_other_districts_with_written_ban": sum(1 for x in peers if x.get("status") == "bans") if county else None,
        "county_other_districts_still_permitting_on_paper": sum(1 for x in peers if x.get("status") in PERMITS) if county else None,
        "national_students_paddled_2023_24": 19851, "national_students_paddled_2013_14": 106055,
        "states_where_still_legal": 17,
        "school_year_on_certificate": "2026-27",
        "earlier_exchange": (f"{prior['did']} {messages.ago(prior.get('when'))}" if prior else None),
    }
    return {k: v for k, v in f.items() if v not in (None, "", [])}

ANGLES = ["policy_last_revised", "county_other_districts", "state_districts_with_written_ban", "enrollment_2023_24", "district_students_paddled_2023_24_federal_data"]
def angle_for(d, f):
    opts = [a for a in ANGLES if a in f and not (a == "county_other_districts" and f.get("county_other_districts", 0) < 2)]
    if not opts: return "state_districts_with_written_ban"
    i = int(hashlib.sha1(str(d["nces_id"]).encode()).hexdigest(), 16)
    return opts[i % len(opts)]

SYSTEM = """You write the opening of a letter from Anthony David Adams, founder of EarthPilot's Safe Schools Project, to a school superintendent whose board has a written policy prohibiting corporal punishment. The letter carries a Safe School certificate for the district (a print-ready PDF with the policy's own sentence and a QR code to the district's entry in the public record at earthpilot.org/kids) and a sample press release. A fixed closing with those two attachments, a request for a short video, and the signature is added after your text, so do not write any of that, and do not sign.

Write two or three short paragraphs, 90 to 160 words in all, that a busy superintendent would read to the end. Warm, specific, plain; the voice of one person who has read this district's policy, not a form letter. Use only the facts given. Every number you write must appear in the facts. Do not invent history, motives, people, dates, or praise you cannot support ("a leader", "a model for the state", "shining example" are out). Say what the policy says, cite its code, and say that the certificate is attached. Lead with the fact named under LEAD WITH, and use at most one or two of the others; leave the rest out. Where the facts show the county or state still largely permits the practice on paper, you may say so in one plain sentence, without naming or shaming any other district. "None recorded" in the federal data means the district reported no students receiving corporal punishment; say it that way or not at all. Do not open with "Congratulations" or "I hope this finds you well". No bullet points, no headings, no markdown, no em dashes, no exclamation marks, no mention of a model, a draft, or an assistant. Write "the district" or its name, never "your district" more than once. Begin directly with the first paragraph; the greeting is added for you."""

def ask(system, user):
    text = writer.ask_cli(system, user, timeout=180) if writer.USE_CLI else None
    if text: return text
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps({"model": writer.WRITER, "max_tokens": 800, "temperature": 0.4, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode(),
        headers={"Authorization": f"Bearer {writer.key()}", "Content-Type": "application/json"})
    try:
        j = json.load(urllib.request.urlopen(req, timeout=120)); return (j["choices"][0]["message"].get("content") or "").strip()
    except Exception as ex:
        writer.LAST_ERROR[0] = repr(ex)[:160]; return None

BANNED = re.compile(r"—|–|!|\bshining\b|\bbeacon\b|\bmodel for\b|\ba leader\b|\bleading the way\b|\bcongratulations\b|hope this (finds|email finds)|\bdear\b|\bsincerely\b|\bregards\b|\bAnthony\b|\bAI\b|assistant|\bdraft\b|\*\*|^#", re.I | re.M)
def problems(text, f):
    allowed = set(re.findall(r"\d+", json.dumps(f).replace(",", "")))
    out = []
    words = len(re.findall(r"\S+", text))
    if not 70 <= words <= 190: out.append(f"{words} words; write 90 to 160")
    bad = [n for n in re.findall(r"\d+", text.replace(",", "")) if n not in allowed]
    if bad: out.append("numbers not in the facts: " + ", ".join(sorted(set(bad))))
    m = BANNED.search(text)
    if m: out.append(f"not allowed: {m.group(0)!r}")
    if f["policy_code"] not in text: out.append(f"cite the policy code {f['policy_code']}")
    if text.count("\n\n") > 3 or text.count("\n\n") < 1: out.append("two or three paragraphs, separated by blank lines")
    return out

def write(d, prior=None, log=print):
    """(plain, html) for the whole cover, or None when no acceptable draft came back."""
    f = facts(d, prior); lead = angle_for(d, f)
    user = f"FACTS (JSON):\n{json.dumps(f, indent=1)}\n\nLEAD WITH: {lead}\n\nWrite the opening paragraphs now."
    text, note = None, None
    for attempt in range(2):
        t = ask(SYSTEM, user + (f"\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED: {note}. Fix that and write it again." if note else ""))
        if not t:
            log(f"cover: no draft for {d['name']} ({writer.LAST_ERROR[0]})"); return None
        t = re.sub(r"\n{3,}", "\n\n", t.strip())
        probs = problems(t, f)
        if not probs: text = t; break
        note = "; ".join(probs); log(f"cover: redo for {d['name']}: {note}")
    if not text: return None
    last = (d.get("superintendent") or "").strip()
    import send as S  # noqa: E402  (the same helpers the template uses)
    greet = f"Dear Superintendent {S.sup_last(last)}," if last else "Dear Superintendent,"
    tail = [
        "Two things you are welcome to do with this: hang it, and tell people. A sample press release is attached as a Word document, written so your office can send it to local media with one edit.",
        "One more, if you are willing. We are collecting thirty-second selfie videos from superintendents, principals and teachers in districts that chose other approaches: what you do instead, what changed, or what you would tell a district that still paddles. No script, phone in hand. Send one at earthpilot.org/kids/video/ and we will put a real face to this.",
        "With respect and thanks,",
        "Anthony David Adams\nFounder, EarthPilot · Safe Schools Project\nearthpilot.org/kids · anthony@175g.com",
    ]
    paras = [greet] + text.split("\n\n") + tail
    import html as H
    def rich(t):
        t = H.escape(t)
        return re.sub(r"(earthpilot\.org/kids(?:/video/)?)", r'<a href="https://\1" style="color:#0D132D">\1</a>', t).replace("\n", "<br>")
    plain = "\n\n".join(paras) + "\n"
    html_doc = f"""<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff"><div style="max-width:620px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0D132D">{''.join(f"<p style='margin:0 0 14px'>{rich(t)}</p>" for t in paras)}</div></body></html>"""
    return plain, html_doc

if __name__ == "__main__":
    import send as S
    nces = S.sys.argv[S.sys.argv.index("--nces") + 1]
    reqs = S.run.load(); d = next(c for c in S.candidates(reqs) if c["nces_id"] == nces)
    print(json.dumps(facts(d, S.prior(d, reqs)), indent=1))
    out = write(d, S.prior(d, reqs))
    print("\n" + (out[0] if out else "NO DRAFT"))
