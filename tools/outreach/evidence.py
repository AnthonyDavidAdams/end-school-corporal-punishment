"""What a document and a sentence must show before a record, or a certificate, stands on them.

On 2026-11-10 and 11 a search fallback returned pages from other websites and seventy-four of them were
filed as the district's own policy: a Yahoo story about Kentucky became Fayette County, Indiana's board
policy, and a Yorktown, New York page (menu text and all) became Okeechobee County, Florida's. Five Safe
School certificates were printed from those sentences. Three checks, each of which alone would have
stopped it:

    document_problem   the page is on the district's own host, names the district, and is not about another state
    quote_problem      the sentence is a sentence: no page furniture, no other state, about corporal punishment
    certificate_problem  both of the above for the record as it stands, plus a second reading of the sentence

Each returns None when there is nothing wrong, otherwise a short reason a person can read.

    tools/.venv/bin/python tools/outreach/evidence.py            # every bans record with a policy, and why any would be held
"""
import json, os, re, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATE_NAMES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
               "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine",
               "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
               "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
               "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
               "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}

# Hosts where a district's website keeps its files. A file here can belong to any district, so it is
# taken only when the document itself names the district and its state (strict, below).
FILE_HOSTS = re.compile(r"(^|\.)(files-backend\.assets\.thrillshare\.com|core-docs\.s3\.amazonaws\.com|resources\.finalsite\.net|files\.smartsites\.parentsquare\.com|[a-z0-9-]+\.sharpschool\.com|campussuite-storage\.s3\.amazonaws\.com)$")
GENERIC = set("""school schools district districts public county city independent isd cisd usd sd corporation corp community consolidated unified central area regional
township twp metropolitan msd the of and at for special charter academy board education department system unit joint union elementary high r i ii iii iv v vi co no""".split())
FURNITURE = re.compile(r"search this site|skip to (main )?content|embedded files|report abuse|google sites|page updated|toggle navigation|breadcrumb|sign in\b|log ?in\b|"
                       r"subscribe|newsletter|cookie|javascript|click here|read more|share this|facebook|twitter|©|https?://|www\.|\bhome\s*[|>»/]|[|»›●■◆▪]", re.I)
ABOUT = re.compile(r"corporal punishment|corporal|paddl|spank", re.I)
BAN = re.compile(r"prohibit|forbid|disallow|\bban(s|ned)?\b|abolish|\b(shall|will|may|must|is|are|does|do|should|can)( not|n't|not)\b|\bnot (be )?(permitted|allowed|used|administered|authorized|tolerated|condoned|an? (acceptable|option))|"
                 r"\bno\b.{0,160}\b(shall|may|will|is|are)\b|\bno (form|use) of\b|\bnever\b|\bunder no circumstances\b|\brefrain\b|\bexclud(es|ing) corporal|\bexcluded from\b|\b(to not|not to) (use|administer|permit|allow|inflict)\b", re.I)


def host_of(url):
    try: return (urllib.parse.urlparse(str(url or "")).hostname or "").lower()
    except Exception: return ""


def own_host(url, domain):
    """True when the address is on the district's own domain (or a subdomain of it)."""
    h, d = host_of(url), str(domain or "").lower()
    return bool(h and d and (h == d or h.endswith("." + d)))


def file_host(url):
    return bool(FILE_HOSTS.search(host_of(url)))


def name_tokens(name):
    """The words that make this district this district: 'Fayette County School Corporation' is 'fayette'."""
    n = re.sub(r"\(\d+\)|\b[A-Z]-?[IVX]+\b|\b\d+\b", " ", str(name or ""))
    return [w for w in re.findall(r"[a-z][a-z'.]+", n.lower().replace(".", "")) if w not in GENERIC and len(w) > 2]


def state_counts(text, skip=()):
    """How often each state is named in the text. 'West Virginia' is not Virginia, and a state word that is
    part of the district's own name (Washington Township, Indiana) is not counted against it."""
    t = re.sub(r"\s+", " ", text or "")
    out = {}
    for ab, nm in STATE_NAMES.items():
        if nm.lower() in skip: continue
        out[ab] = len(re.findall(r"\b" + re.escape(nm) + r"\b", t))
    out["VA"] = max(0, out.get("VA", 0) - out.get("WV", 0))
    out["WA"] = max(0, out.get("WA", 0) - len(re.findall(r"\bWashington,? D\.?C\b", t)))
    return out


def document_problem(text, name, state, strict=False):
    """Why this text cannot be taken as this district's own document, or None.

    Always: it names the district, and it is not mostly about another state. With strict (the file sits on
    a shared file host, where the address proves nothing): it also names the district's own state."""
    low = re.sub(r"\s+", " ", (text or "")).lower()
    toks = name_tokens(name)
    if not toks: return "the district's name has no word of its own to look for"
    missing = [w for w in toks if not re.search(r"\b" + re.escape(w), low)]
    if missing: return f"the document never says '{' '.join(missing)}'"
    c = state_counts(text, skip={w for w in name.lower().split()} | {name.lower()})
    own = c.get(state, 0); other, n = max(((k, v) for k, v in c.items() if k != state), key=lambda kv: kv[1], default=(None, 0))
    if n >= 2 and n > own: return f"the document is about {STATE_NAMES[other]} ({n} mentions; {STATE_NAMES.get(state, state)} {own})"
    if strict and own == 0: return f"the document never says {STATE_NAMES.get(state, state)}"
    return None


def quote_problem(q, state=None, name=""):
    """Why this sentence cannot be printed as the district's own words, or None."""
    q = re.sub(r"\s+", " ", str(q or "")).strip()
    if len(q.split()) < 4: return "too short to be a rule"
    if len(q) > 600: return "too long to be one sentence"
    if not ABOUT.search(q): return "does not mention corporal punishment"
    m = FURNITURE.search(q)
    if m: return f"carries page furniture ('{m.group(0).strip()}')"
    if q.count("[") != q.count("]") or q.count("(") != q.count(")"): return "is cut mid-phrase (unbalanced brackets)"
    letters = [ch for ch in q if ch.isalpha()]
    if letters and sum(ch.isupper() for ch in letters) > 0.4 * len(letters): return "is mostly capitals: a heading, not a sentence"
    if len(re.findall(r"(?<![\w(.'’])[b-hj-z](?![\w).])", q)) >= 2: return "has broken spacing from the text extraction"
    if re.search(r"&(nbsp|amp|quot|#\d+);|</?[a-z]+[ >/]", q): return "carries web markup"
    if re.search(r"[^\x00-\x7f“”‘’–—§½¼¾éñ]{2,}|[_~^]{2,}|-—|—-", q): return "carries characters a scan left behind"
    if state:
        c = state_counts(q, skip={w for w in str(name).lower().split()})
        for k, v in c.items():
            if v and k != state: return f"names {STATE_NAMES[k]}"
    return None


HEADING = re.compile(r"^(?P<junk>.{0,140}?\b(?:CORPORAL PUNISHMENT|Corporal Punishment)(?:\s*\([^)]{0,40}\))?[\s:.\-–—]+(?:[A-Z]{2,5}\s+)?)"
                     r"(?=[\"“]?(?:The|A|An|No|Corporal|It|In|Students?|School|Employees?|Teachers?|District|Board|Under|Use|Any|All|Staff|Physical)\b)")
CROSSREF = re.compile(r"^(?:\[(?:For|See)\b[^\]]{0,400}\]|\((?:For|See)\b[^)]{0,300}\))[.\s]*")
TAIL = re.compile(r"[\s,;(\[]*\b(Approved|Adopted|Revised|Reviewed|Legal Ref(erence)?s?|Cross Ref(erence)?s?|Reference|Date Adopted)\b\s*:.*$", re.S)


def print_sentence(q):
    """The board's sentence as it should be printed. A clip often carries the section heading run in at the
    front ("Corporal Punishment The Board prohibits ...", "JDA CORPORAL PUNISHMENT Corporal punishment
    shall not ...") and an "Approved:" line behind. Those are the page, not the rule. Nothing is reworded
    and nothing is cut from the middle: what comes back is the quote with the heading and the adoption
    line taken off, or the quote itself when taking them off leaves less than a rule."""
    q0 = re.sub(r"[\u200b\u00a0\s]+", " ", str(q or "")).strip()
    pick = CROSSREF.sub("", q0)   # "[For provisions regarding students with disabilities, see FOF(LEGAL) ...] Corporal Punishment The Board prohibits ..."
    for _ in range(3):
        m = HEADING.match(pick)
        if not m or BAN.search(re.sub(r"(?i)corporal punishment", "", m.group("junk"))): break
        pick = pick[m.end():]
    pick = re.sub(r"^[A-Z]{2,5}(-[A-Z])?\s+(?=Corporal punishment\b)", "", pick)
    pick = TAIL.sub("", pick).strip().strip('"“”').rstrip(",;").strip()
    if pick and pick[-1].isalnum(): pick += "."
    return pick if (len(pick.split()) >= 4 and ABOUT.search(pick) and BAN.search(pick) and not quote_problem(pick)) else q0


def reads_as_ban(q):
    q = re.sub(r"\s+", " ", str(q or ""))
    return bool(BAN.search(q))


def second_reading(q, name, state):
    """Jev's probability that the sentence is a school board's own rule prohibiting corporal punishment.
    None when Jev cannot be reached; the caller decides what that means (for a certificate: wait)."""
    try:
        import triage
        a = triage.jev({"sentence": q, "district": name, "state": STATE_NAMES.get(state, state)}, {"rule": {"type": "noul",
            "instructions": "Is the sentence, read on its own, a school district's own written rule that prohibits corporal punishment of students in its schools?",
            "criteria": {"true": "It is the text of a policy or handbook rule, complete enough to print, and it prohibits corporal punishment (or says it is not used or not permitted) in the district's schools.",
                         "false": "It permits corporal punishment, or is news, commentary, an essay, a statute summary, a table of contents, a heading, website menu text, a fragment, or a rule about something else (restraint, child abuse reporting, another institution)."}}}, timeout=45)["rule"]
        return float(a.get("noul"))
    except Exception:
        return None


def local_path(source):
    """The file in this repository behind a raw.githubusercontent source, if that is what it is."""
    m = re.search(r"/main/(data/policies/[^?#]+)$", str(source or ""))
    if not m: return None
    p = os.path.join(ROOT, m.group(1))
    return p if os.path.exists(p) or not os.path.exists(p + ".pdf") else p + ".pdf"   # an html page kept as its print


def certificate_problem(x, state, read_text=None, jev=True):
    """Why this record must not go on a certificate today, or None. x is the district record.

    read_text(path) turns a kept file into text (run.doc_text); without it the document check is skipped
    for kept files, and the caller should pass it."""
    q = print_sentence(x.get("quote") or "")
    p = quote_problem(q, state, x.get("name") or "")
    if p: return "the sentence " + p
    if not reads_as_ban(q): return "the sentence does not read as a prohibition"
    src = str(x.get("source") or "")
    path = local_path(src)
    if path and "-recheck-" in path:
        if not os.path.exists(path): return "the kept document is missing"
        if read_text:
            text = read_text(path)
            flat = re.sub(r"\W+", " ", text).lower(); want = re.sub(r"\W+", " ", q).lower().strip()
            if want[:80] not in flat: return "the sentence is not in the kept document"
            # a kept file found by search carries no address; the document has to prove whose it is
            dp = document_problem(text, x.get("name") or "", state, strict=True)
            if dp: return dp
    if jev:
        s = second_reading(q, x.get("name") or "", state)
        if s is None: return "the second reading could not be reached; waiting a cycle"
        if s < 0.5: return f"a second reading does not take the sentence as a board's prohibition ({s:.2f})"
    return None


if __name__ == "__main__":
    import yaml
    held = 0; n = 0
    for f in sorted(os.listdir(os.path.join(ROOT, "data/districts"))):
        if not f.endswith(".yaml"): continue
        for x in yaml.safe_load(open(os.path.join(ROOT, "data/districts", f)))["districts"]:
            if x.get("status") != "bans" or not x.get("quote") or not x.get("policy_code"): continue
            n += 1
            p = certificate_problem(x, f[:2], jev=False)
            if p: held += 1; print(f"{f[:2]}  {x['name'][:36]:<36}  {p}  |  {x['quote'][:90]}")
    print(f"{n} bans records with a policy; {held} would be held (second reading not run)")
