#!/usr/bin/env python3
"""Whose document is this? What a document found by searching must show before it becomes a district's record.

The search is given a district's name and returns the best-looking policy documents on the open web. The
name is then matched to the federal directory, and until 2026-11-11 that match was the only proof of
identity: it proves which district we were LOOKING for, and nothing about whose document came back. That
night's run recorded six districts and five of them quoted somebody else: Greene County, Alabama got
Greensburg, Indiana's guideline; Russell County, Alabama got Russell County, Virginia's conduct code;
Vernon Parish got East Baton Rouge's handbook; Sterling, Oklahoma got Sterling, Illinois; Sweetwater,
Oklahoma got Sweetwater, Tennessee. The sixth was the right district's code of conduct from 2019-20.

So a searched document is recorded only when one of these holds, and is otherwise held for a person:

    own site     the address is on the district's own website (federal directory, worklist, sites index)
    its text     read in full, the document names the district (in its first lines, or three times), names
                 the district's state, and names no other state more often

and never when the address is another district's website, when the document is an edition older than last
school year, or when the chosen sentence is a heading, a contents line, page furniture, or (for a ban)
does not read as a prohibition.

It rewrites classified.json in place: a row that passes gains `identity: {ok: true, how}`; a row that
does not has its decision changed to needs_review with the reason in `held_for`. records-from-classified.py
refuses any searched document that does not carry the passing stamp, so this step cannot be skipped.

    python3 tools/tasb/identity.py <classified.json> [<slice.json>] [--dry]
"""
import csv, datetime, json, os, re, sys, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools", "outreach"))
import evidence  # noqa: E402  (stdlib only; shared with the certificate gate so the two cannot drift)

SERVER = "https://escp-mcp-production.up.railway.app/mcp"
# Addresses many districts share. Being listed as a district's website does not make one of these that
# district's own host, and a file on one can belong to anybody.
SHARED = re.compile(r"(^|\.)(facebook\.com|google\.com|sites\.google\.com|wixsite\.com|weebly\.com|schoolboard\.net|neola\.com|boarddocs\.com|eboardsolutions\.com|"
                    r"amazonaws\.com|multiscreensite\.com|finalsite\.net|thrillshare\.com|parentsquare\.com|sharpschool\.com|schoolinsites\.com|edl\.io|schoolwires\.net)$|"
                    r"^(k12|state)\.[a-z]{2}\.us$|^[a-z]{2}\.gov$")


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower().replace("mtn", "mountain")).replace(" school district", "").replace(" public schools", "").replace(" schools", "").strip()


def host(u):
    h = evidence.host_of(u if "//" in str(u or "") else "http://" + str(u or ""))
    return h[4:] if h.startswith("www.") else h


def directory():
    rows = list(csv.DictReader(open(os.path.join(ROOT, "data/nces/lea-directory-2023-24.csv"))))
    by_id = {r["nces_id"]: r for r in rows}
    by_name = {}
    for r in rows: by_name.setdefault((r["state"], norm(r["name"])), []).append(r)
    owners = {}
    for r in rows:
        h = host(r.get("website"))
        if h and not SHARED.search(h): owners.setdefault(h, []).append(r)
    return by_id, by_name, owners


def record_names():
    """nces_id -> the name the district already has on file, read without a YAML parser."""
    out = {}
    d = os.path.join(ROOT, "data/districts")
    for f in os.listdir(d):
        if not f.endswith(".yaml"): continue
        for block in open(os.path.join(d, f)).read().split("\n  - name: ")[1:]:
            m = re.search(r'^    nces_id: "?(\d+)"?\s*$', block, re.M)
            if m: out[m.group(1)] = block.split("\n")[0].strip().strip("\"'")
    return out


def full_text(url):
    """The whole document as the crew server reads it, or '' when it cannot be read."""
    def call(args):
        req = urllib.request.Request(SERVER, method="POST", headers={"content-type": "application/json", "accept": "application/json, text/event-stream"},
                                     data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "fetch_document", "arguments": args}}).encode())
        body = urllib.request.urlopen(req, timeout=180).read().decode("utf-8", "replace")
        line = next((l for l in body.split("\n") if l.startswith("data: ")), None)
        r = json.loads(line[6:])["result"]
        return None if r.get("isError") else json.loads(r["content"][0]["text"])
    try:
        j = call({"url": url, "terms": ["corporal punishment"], "context_words": 20})
        if not j or j.get("needs_ocr"): return ""
        f = call({"url": url, "pages": f"1-{min(j.get('page_count') or 1, 400)}"}) or {}
        pages = f.get("pages") if isinstance(f.get("pages"), list) else []
        return f.get("text") or "\n".join(p if isinstance(p, str) else str((p or {}).get("text", "")) for p in pages)
    except Exception:
        return ""


def edition(url, text):
    """The school year a document says it is for, as (2019, '2019-20'), or None when it does not say."""
    for src in (urllib.parse.unquote(str(url or "")), (text or "")[:1500]):
        for m in re.finditer(r"(?<!\d)(20[12]\d)\s*[-–/_]\s*(?:20)?(\d\d)(?!\d)", src):
            if int(m.group(2)) == (int(m.group(1)) + 1) % 100: return int(m.group(1)), re.sub(r"\s+", "", m.group(0))
    return None


def names_it(text, names):
    """Why the text cannot be said to name this district, or None. A county or parish district must be
    named with that word ('Vernon Parish'; a Mr. Vernon in another parish's handbook is not it). The name
    has to sit in the opening lines or come up three times: once, deep in a neighbour's athletics
    schedule, is not a document's owner."""
    low = re.sub(r"\s+", " ", text or "").lower()
    best = None
    for name in names:
        m = re.match(r"\s*(.+?)\s+(county|parish)\b", str(name or ""), re.I)
        if m:
            pat = r"\b" + r"\s+".join(re.escape(w) for w in m.group(1).lower().split()) + r"\s+(?:" + m.group(2).lower() + r"|co\b\.?)"
            said = f"{m.group(1)} {m.group(2)}"
        else:
            toks = evidence.name_tokens(name)
            if not toks: continue
            pat = r"\b" + r"\b.{0,40}?\b".join(re.escape(w) for w in toks) if len(toks) > 1 else r"\b" + re.escape(toks[0]) + r"\b"
            said = " ".join(toks)
        hits = [x.start() for x in re.finditer(pat, low)]
        if hits and (hits[0] < 3000 or len(hits) >= 3): return None
        best = best or (f"the document says '{said}' only {len(hits)} time{'s' if len(hits) != 1 else ''}, and not near its top" if hits else f"the document never says '{said}'")
    return best or "the district's name has no word of its own to look for"


def whose(row, d, by_id, owners, names_on_file, read=full_text, today=None, sentence=True):
    """(ok, how) for one classified row. `d` is what we know of the district: nces_id, state, name, websites.
    `sentence=False` checks the document alone (a record that says the documents are silent has no sentence)."""
    today = today or datetime.date.today()
    state, name, src, q = row.get("_state"), row.get("district"), row.get("source") or "", row.get("quote") or ""
    why = evidence.quote_problem(q, state, name) if sentence else None
    if not sentence: q = ""
    if not why and re.search(r"\.{4,}|…{2,}|(\. ){4,}", q): why = "is a line from a table of contents"
    if not why and row.get("status") == "bans" and not evidence.reads_as_ban(q): why = "is recorded as a ban but does not read as a prohibition"
    if why: return False, f"the sentence {why}"
    h = host(src)
    if not h: return False, "the source is not a web address"
    mine = {x for x in (host(w) for w in d.get("websites", [])) if x and not SHARED.search(x)}
    theirs = [r for r in owners.get(h, []) if r["nces_id"] != d.get("nces_id")]
    if theirs and h not in mine:
        return False, f"{h} is the website of {theirs[0]['name'].title()}, {theirs[0]['state']}"
    text = None
    if any(h == m or h.endswith("." + m) for m in mine): how = f"on the district's own website ({h})"
    else:
        text = read(src)
        if len(text or "") < 500: return False, "the document could not be read in full to check whose it is"
        names = [n for n in dict.fromkeys([names_on_file.get(d.get("nces_id")), (by_id.get(d.get("nces_id")) or {}).get("name"), name]) if n]
        why = names_it(text, names)
        if why: return False, why
        c = evidence.state_counts(text, skip={w for n in names for w in n.lower().split()})
        own = c.get(state, 0); other, n = max(((k, v) for k, v in c.items() if k != state), key=lambda kv: kv[1], default=(None, 0))
        nm = evidence.STATE_NAMES
        if own == 0: return False, f"the document never says {nm.get(state, state)}" + (f" (it says {nm[other]} {n} time{'s' if n != 1 else ''})" if n else "")
        if n > own: return False, f"the document is about {nm[other]} ({n} mentions; {nm.get(state, state)} {own})"
        how = f"not on the district's own website ({h}); read in full, the document names the district and {nm.get(state, state)} ({own} mentions) and no other state more often"
    ed = edition(src, text or "")
    year = today.year if today.month >= 7 else today.year - 1
    if ed and ed[0] < year - 1: return False, f"the document is an old edition ({ed[1]}), a lead and not the current rule"
    return True, how


def audit(out_path, workers=6):
    """Every searched document already on file, put to the same question. Reads; changes nothing.

        tools/.venv/bin/python tools/tasb/identity.py --audit out/audit/identity-2026-11-11.json
    """
    import glob, gzip, yaml
    from concurrent.futures import ThreadPoolExecutor
    by_id, by_name, owners = directory()
    names_on_file = record_names()
    sites = {}
    for s in json.load(open(os.path.join(ROOT, "data/sites/index.json"))):
        if s.get("nces_id"): sites[str(s["nces_id"])] = [s.get("live_website"), s.get("listed_website")]
    cached = {m["source"]: m["path"] for m in json.load(open(os.path.join(ROOT, "data/policies/manifest.json")))}
    def read(url):
        p = cached.get(url)
        if p and os.path.exists(os.path.join(ROOT, p)):
            try: return gzip.open(os.path.join(ROOT, p), "rt", encoding="utf-8", errors="replace").read()
            except Exception: pass
        return full_text(url)
    todo = []
    for f in sorted(glob.glob(os.path.join(ROOT, "data/districts/*.yaml"))):
        st = os.path.basename(f)[:2]
        for d in yaml.safe_load(open(f)).get("districts", []):
            if d.get("method") == "searched_document" and str(d.get("source") or "").startswith("http"): todo.append((st, d))
    def one(item):
        st, d = item; nces = str(d.get("nces_id") or "")
        row = {"_state": st, "district": d["name"], "source": d["source"], "quote": d.get("quote"), "status": d.get("status")}
        who = {"nces_id": nces, "state": st, "name": d["name"], "websites": [d.get("website"), (by_id.get(nces) or {}).get("website"), *sites.get(nces, [])]}
        try: ok, how = whose(row, who, by_id, owners, names_on_file, read=read, sentence=bool(d.get("quote")))
        except Exception as ex: ok, how = False, f"check failed: {ex!r}"[:160]
        return {"state": st, "name": d["name"], "nces_id": nces, "status": d.get("status"), "last_verified": str(d.get("last_verified")), "source": d["source"], "ok": ok, "how": how}
    with ThreadPoolExecutor(workers) as ex: res = list(ex.map(one, todo))
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    json.dump(res, open(out_path, "w"), indent=1)
    bad = [r for r in res if not r["ok"]]
    print(f"audit: {len(res)} searched documents on file, {len(res) - len(bad)} proven, {len(bad)} not")


def main():
    if "--audit" in sys.argv: return audit(sys.argv[sys.argv.index("--audit") + 1])
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry" in sys.argv
    rows = json.load(open(args[0]))
    slice_rows = json.load(open(args[1])) if len(args) > 1 and os.path.exists(args[1]) else []
    by_id, by_name, owners = directory()
    names_on_file = record_names()
    sites = {}
    try:
        for s in json.load(open(os.path.join(ROOT, "data/sites/index.json"))):
            if s.get("nces_id"): sites[str(s["nces_id"])] = [s.get("live_website"), s.get("listed_website")]
    except Exception: pass
    in_slice = {(k, s.get("name")): s for s in slice_rows for k in (s.get("state"), s.get("code")) if k}
    passed = held = 0
    for row in rows:
        if row.get("decision") != "record": continue
        st, name = row.get("_state"), row.get("district")
        s = in_slice.get((st, name)) or {}
        nces = str(s.get("nces_id") or "")
        if not nces:
            c = by_name.get((st, norm(name)), [])
            nces = c[0]["nces_id"] if len(c) == 1 else ""
        d = {"nces_id": nces, "state": st, "name": name,
             "websites": [s.get("website"), (by_id.get(nces) or {}).get("website"), *sites.get(nces, [])]}
        ok, how = whose(row, d, by_id, owners, names_on_file)
        row["identity"] = {"ok": ok, "how": how}
        if ok: passed += 1; print(f"  whose: {st} {name}: {how}")
        else:
            held += 1; row["decision"] = "needs_review"; row["held_for"] = how
            print(f"  HELD {st} {name}: {how} | {row.get('source', '')[:110]}")
    if not dry: json.dump(rows, open(args[0], "w"), indent=1)
    print(f"identity: {passed} proven, {held} held for review{' (dry run, nothing written)' if dry else ''}")


if __name__ == "__main__":
    main()
