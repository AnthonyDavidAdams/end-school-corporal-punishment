"""Look again, on their own domain, before asking a second time.

Eight of the first twenty-eight replies said some version of "it's on our website". They are usually
right that it is published and usually wrong that it is findable: the link is three levels down under
"State Required Information", or it is the 2019 handbook, or the page they mean is a login. Writing
back "I can't find it" without looking again is how a project becomes a nuisance.

So: take the domain from the address that answered us -- which is the district's own domain, not one we
guessed -- ask a search engine for that domain only, fetch what comes back, and run it through the same
clip-and-classify path as any other document. If the rule is there, the district never hears from us
again except to be thanked. If it is not, the next email can say exactly where we looked, which is a
different and much better email than "I can't find it".

    python3 tools/outreach/recheck.py <nces_id|name> [domain]     # try one, print what happened
"""
import html as htmllib
import json, os, re, subprocess, sys, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
SKIP_DOMAINS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "googlemail.com"}


def brave_key():
    for path in ("~/.brave.env",):
        p = os.path.expanduser(path)
        if os.path.exists(p):
            for l in open(p):
                if l.startswith("BRAVE"):
                    return l.split("=", 1)[1].strip().strip('"')
    return os.environ.get("BRAVE_API_KEY")


def domain_of(addr_or_url):
    """The district's own host, from the address that wrote to us or from the directory website."""
    s = str(addr_or_url or "").strip()
    if not s:
        return None
    if "@" in s and "://" not in s:
        d = s.rsplit("@", 1)[1].lower()
    else:
        try:
            d = urllib.parse.urlparse(s if "://" in s else "http://" + s).hostname or ""
        except Exception:
            return None
        d = d.lower()
    d = re.sub(r"^(www|mail|webmail|mx)\.", "", d)
    return None if (not d or d in SKIP_DOMAINS or "." not in d) else d


class SearchDown(RuntimeError):
    pass


_brave_down = False      # set for the life of the process the first time Brave refuses


def _brave(q, count=12):
    key = brave_key()
    if not key:
        raise SearchDown("no Brave key")
    url = f"https://api.search.brave.com/res/v1/web/search?q={urllib.parse.quote(q)}&count={count}&country=us"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "X-Subscription-Token": key})
    try:
        j = json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        if e.code in (402, 429):   # no credit, or throttled: say so, never "nothing indexed" (absent is not negative)
            raise SearchDown(f"Brave {e.code}: {e.read()[:100]!r}")
        return []
    except Exception:
        return []
    return [{"title": x.get("title", ""), "url": x.get("url", ""), "snippet": (x.get("description") or "")[:200]}
            for x in (j.get("web", {}).get("results") or [])]


def _relay(queries):
    """The same queries through tools/lib/relay-search.mjs (the Claude CLI's web search, on the plan,
    no API spend). One call carries every query. Raises SearchDown when the relay itself fails, so a
    caller still cannot mistake "could not search" for "searched and found nothing"."""
    try:
        r = subprocess.run(["node", os.path.join(ROOT, "tools", "lib", "relay-search.mjs"), *queries],
                           capture_output=True, text=True, timeout=300)
    except Exception as e:
        raise SearchDown(f"Brave is refusing and the relay failed too: {e}")
    if r.returncode != 0:
        raise SearchDown(f"Brave is refusing and the relay failed too: {(r.stderr or r.stdout)[:120]}")
    try:
        per = json.loads(r.stdout)
    except Exception:
        raise SearchDown("Brave is refusing and the relay returned something unreadable")
    return [[{"title": x.get("title", ""), "url": x.get("url", ""), "snippet": (x.get("snippet") or "")[:200]}
             for x in (per[i] if i < len(per) else [])] for i in range(len(queries))]


def search_many(queries):
    """One result list per query. Brave first; when it refuses (402, 429) the rest go through the relay."""
    global _brave_down
    out = []
    for i, q in enumerate(queries):
        if not _brave_down:
            try:
                out.append(_brave(q))
                continue
            except SearchDown:
                _brave_down = True
        out.extend(_relay(queries[i:]))
        break
    return out


def search(q, count=12):
    return search_many([q])[0]


def candidates(district, state, domain):
    """Documents on the district's own host that could carry the rule, best first.

    Ordered by how likely each is to be the thing rather than a mention of the thing: a board policy
    manual beats a handbook, a handbook beats a news page. Duplicate URLs collapse, and anything that is
    plainly not a document the district publishes about itself is dropped.
    """
    seen, out = set(), []
    queries = [
        f'site:{domain} "corporal punishment"',
        f'site:{domain} board policy manual',
        f'site:{domain} student handbook',
        f'site:{domain} "code of conduct" OR "student discipline"',
        f'site:{domain} "state required information"',
    ]
    for results in search_many(queries):
        for r in results:
            u = r["url"]
            if not u or u in seen:
                continue
            if re.search(r"/(login|signin|calendar|athletics|sports|lunch|menu|staff-directory)\b", u, re.I):
                continue
            # The relay does not enforce site: the way Brave does. A page on any other host is not the
            # district's own document, whatever it says: a Yahoo story about Kentucky was filed as
            # Fayette County, Indiana's board policy on 2026-11-11.
            host = (urllib.parse.urlparse(u).hostname or "").lower()
            if not (host == domain or host.endswith("." + domain)):
                continue
            seen.add(u)
            score = 0
            hay = (r["title"] + " " + r["snippet"] + " " + u).lower()
            if "corporal" in hay:
                score += 6
            if re.search(r"polic(y|ies)|manual", hay):
                score += 3
            if "handbook" in hay or "conduct" in hay:
                score += 2
            if u.lower().endswith(".pdf"):
                score += 2
            if "state required" in hay:
                score += 2
            out.append({**r, "score": score})
    out.sort(key=lambda x: -x["score"])
    return out


def fetch(url, dest):
    try:
        subprocess.run(["curl", "-sL", "-m", "75", "-A", UA, "-o", dest, url], timeout=100, capture_output=True)
        return os.path.getsize(dest) > 800 if os.path.exists(dest) else False
    except Exception:
        return False


def recheck(r, file_document, log=print, limit=6):
    """Try to settle this district from its own site. Returns (status_or_None, urls_tried).

    file_document is passed in rather than imported so this module stays testable and so the caller
    keeps control of what writing to the record means.
    """
    domain = domain_of(r.get("answered_from") or r.get("to")) or domain_of(r.get("website"))
    if not domain:
        return None, []
    cands = candidates(r["name"], r["state"], domain)
    if not cands:
        return None, [f"(nothing indexed on {domain})"]
    tried, got = [], None
    dd = os.path.join(ROOT, "data/policies/inbound", r["state"])
    os.makedirs(dd, exist_ok=True)
    for c in cands[:limit]:
        u = c["url"]
        tried.append(u)
        ext = ".pdf" if ".pdf" in u.lower() else ".html"
        p = os.path.join(dd, f"{r.get('nces_id') or r['id']}-recheck-{abs(hash(u)) % 10**8}{ext}")
        if not fetch(u, p):
            continue
        try:
            status = file_document(r, p, f"re-checked on the district's own site: {u}")
        except Exception as e:
            log("recheck: could not file", u, repr(e)[:120])
            continue
        if status and status != "held":
            got = status
            break
    return got, tried


if __name__ == "__main__":
    reqs = json.load(open(os.path.join(ROOT, "data/outreach/requests.json")))
    key = sys.argv[1]
    r = next((x for x in reqs if str(x.get("nces_id")) == key or key.lower() in x["name"].lower()), None)
    if not r:
        sys.exit(f"no request matching {key}")
    dom = sys.argv[2] if len(sys.argv) > 2 else (domain_of(r.get("answered_from") or r.get("to")))
    print(f"{r['state']} {r['name']} · domain {dom}")
    for c in candidates(r["name"], r["state"], dom)[:8]:
        print(f"  {c['score']:>2}  {c['url'][:110]}")


# ---------------------------------------------------------------- following a link to the actual file
DRIVE = re.compile(r"drive\.google\.com/file/d/([\w-]{20,})")
DRIVE_OPEN = re.compile(r"drive\.google\.com/open\?id=([A-Za-z0-9_-]+)")
DOCS = re.compile(r"docs\.google\.com/(document|spreadsheets|presentation)/d/([\w-]{20,})")


def expand(url):
    """A link a superintendent sends is usually a page about the document, not the document.

    Google Drive gives a viewer, BoardDocs and BoardOnTrack give a landing page, and a district's
    "board policies" link is an index of sixty policies. Each of those is one hop from the file. This
    returns the direct addresses worth fetching, best first, without following anything off the host.
    """
    out = []
    m = DRIVE.search(url) or DRIVE_OPEN.search(url)
    if m:
        out.append(f"https://drive.google.com/uc?export=download&id={m.group(1)}")
        out.append(f"https://docs.google.com/document/d/{m.group(1)}/export?format=txt")
    m = DOCS.search(url)
    if m:
        kind = {"document": "txt", "spreadsheets": "csv", "presentation": "pdf"}[m.group(1)]
        out.append(f"https://docs.google.com/{m.group(1)}/d/{m.group(2)}/export?format={kind}")
    out.append(url)
    return out


def gdoc_links(url, path):
    """A Google Doc that is the district's index of policies: the files linked from the rows that name
    corporal punishment. Harrison AR sent its index twice (2026-10-12 and 11-10) and was asked twice for
    "the direct link to 4.39", which was one click away in the document the superintendent had sent.
    The text export drops hyperlinks, so the page export is read for them. One hop, the district's own
    document, and only the rows that name the practice."""
    m = DOCS.search(url)
    if not m or m.group(1) != "document":
        return []
    try:
        if not re.search(r"corporal", open(path, encoding="utf-8", errors="ignore").read(400_000), re.I):
            return []
        page = path + ".index.html"
        if not fetch(f"https://docs.google.com/document/d/{m.group(2)}/export?format=html", page):
            return []
        html = open(page, encoding="utf-8", errors="ignore").read(3_000_000)
        os.remove(page)
    except Exception:
        return []
    out = []
    for row in re.findall(r"<tr\b.*?</tr>", html, re.I | re.S):
        if not re.search(r"corporal", re.sub(r"<[^>]+>", " ", row), re.I):
            continue
        for u in re.findall(r'href="([^"]+)"', row):
            u = htmllib.unescape(u)
            q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get("q")
            u = q[0] if q and "google.com/url" in u else u
            if (DRIVE.search(u) or DRIVE_OPEN.search(u) or DOCS.search(u) or re.search(r"\.(pdf|docx?)(\?|$)", u, re.I)) and u not in out:
                out.append(u)
    return out[:2]


def links_inside(path, base, want=r"corporal|polic|handbook|conduct|discipline|manual"):
    """PDF and document links on a page we just fetched, ranked by how much they look like the thing."""
    try:
        html = open(path, encoding="utf-8", errors="ignore").read(600_000)
    except Exception:
        return []
    if "<" not in html[:2000]:
        return []
    found = {}
    for m in re.finditer(r'href=["\']([^"\']+)["\'][^>]*>(.{0,120}?)</a>', html, re.I | re.S):
        u, label = m.group(1), re.sub(r"<[^>]+>|\s+", " ", m.group(2)).strip()
        if u.startswith("#") or u.lower().startswith(("mailto:", "tel:", "javascript:")):
            continue
        full = urllib.parse.urljoin(base, u)
        hay = (label + " " + full).lower()
        score = 0
        if "corporal" in hay:
            score += 8
        if re.search(want, hay):
            score += 3
        if re.search(r"\.(pdf|docx?)(\?|$)", full, re.I):
            score += 4
        if DRIVE.search(full) or DOCS.search(full):
            score += 3
        if score >= 4:
            found[full] = max(found.get(full, 0), score)
    return [u for u, _ in sorted(found.items(), key=lambda kv: -kv[1])][:6]
