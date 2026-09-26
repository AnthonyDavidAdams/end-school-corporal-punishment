"""A true, specific compliment for the top of a records request.

A district office reads a public-records request as a demand from a stranger. One sentence that shows
the stranger actually looked at the district -- the robotics team that placed at state, the new
career academy, the bus driver honored by the board -- changes who is writing. The sentence has to be
true and recent, so it is built from the district's own news and nothing is invented:

  1. Google News RSS for the district (free, no key): up to ~100 headlines with source and date.
  2. Jev picks the one headline that is positive news about THIS district (an achievement, award,
     recognition, program, or milestone), or says none. Budgets, elections, lawsuits, closures, and
     neighbouring districts are all "none". Judgment only: the choice is over headlines we were handed.
  3. A cheap writer turns that one headline into one plain sentence a person could say to the office.
  4. Jev checks the sentence against the headline -- accurate, not exaggerated, no invented detail --
     and anything that fails is dropped. No compliment is better than a wrong one.

    python3 tools/outreach/compliment.py "Alachua County Public Schools" FL     # preview one
"""
import json, os, re, sys, time, urllib.parse, urllib.request, email.utils, datetime
import xml.etree.ElementTree as ET

WRITER = "anthropic/claude-haiku-4.5"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

def key():
    for l in open(os.path.expanduser("~/personality-bench/.env.local")):
        if l.startswith("OPENROUTER"): return l.split("=", 1)[1].strip().strip('"')

STATE_NAMES = {"AL":"Alabama","AR":"Arkansas","AZ":"Arizona","FL":"Florida","GA":"Georgia","IN":"Indiana","KS":"Kansas","KY":"Kentucky","LA":"Louisiana","MO":"Missouri","MS":"Mississippi","NC":"North Carolina","OK":"Oklahoma","SC":"South Carolina","TN":"Tennessee","TX":"Texas","WY":"Wyoming"}

def headlines(name, state, months=12):
    """Recent headlines about the district from Google News RSS: title, source, date, url."""
    q = f'"{name}" {STATE_NAMES.get(state, state)} school'
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q, "hl": "en-US", "gl": "US", "ceid": "US:en"})
    q2 = f'"{name}" {STATE_NAMES.get(state, state)} (award OR champions OR honored OR wins OR recognized OR "state finalist" OR "national")'
    url2 = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q2, "hl": "en-US", "gl": "US", "ceid": "US:en"})
    # Small districts rarely appear under their formal name; the town does. "Gurdon School District" gets
    # five hits, "Gurdon" Arkansas school gets the ballgame and the FFA chapter.
    short = re.sub(r"\s+(public schools?|school district|schools?|independent school district|isd|cisd|consolidated.*|r-[ivx]+.*|county schools?)$", "", name, flags=re.I).strip()
    q3 = f'"{short}" {STATE_NAMES.get(state, state)} school students' if short and short.lower() != name.lower() else None
    url3 = q3 and "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q3, "hl": "en-US", "gl": "US", "ceid": "US:en"})
    items = []
    for u in (url2, url, url3):
        if not u: continue
        try:
            raw = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=30).read()
            items += ET.fromstring(raw).findall(".//item")
        except Exception:
            continue
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30 * months)
    out, seen = [], set()
    for it in items:
        if (it.findtext("title") or "") in seen: continue
        seen.add(it.findtext("title") or "")
        title = (it.findtext("title") or "").strip(); src = (it.findtext("source") or "").strip()
        try: when = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "")
        except Exception: continue
        if when < cutoff: continue
        title = re.sub(r"\s+-\s+" + re.escape(src) + r"\s*$", "", title) if src else title
        out.append({"title": title, "source": src, "date": when.date().isoformat(), "url": it.findtext("link") or ""})
    return out[:40]

def jev(state, questions):
    req = urllib.request.Request("https://openrouter.ai/api/alpha/decisions",
                                 data=json.dumps({"model": "typesafe/jev-1.13", "state": state, "questions": questions}).encode(),
                                 headers={"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))["answers"]

def pick(name, state, items):
    """Score every headline on its own (a 40-way choice spreads Jev's probability too thin to trust), then
    take the best one if it clears the bar."""
    if not items: return None
    from concurrent.futures import ThreadPoolExecutor
    def score(h):
        q = {"good": {"type": "noul",
             "instructions": f"Is this headline good news about {name} ({STATE_NAMES.get(state, state)}) itself -- a student, team, school, teacher or staff achievement; an award, grade improvement or recognition; a new program, school or facility; a milestone -- that a stranger could sincerely congratulate the district office on?",
             "criteria": {"true": "Positive news about this district's own students, staff, schools or programs: an achievement, award, honor, opening, or milestone.",
                          "false": "Budgets, taxes, elections, board politics, lawsuits, closures, layoffs, discipline, crime, weather, routine announcements, or news about a different district, a college, or a private school."}}}
        try: return float(jev({"district": name, "state": state, "headline": h["title"], "source": h["source"], "date": h["date"]}, q)["good"].get("noul") or 0)
        except Exception: return 0.0
    with ThreadPoolExecutor(8) as ex: scores = list(ex.map(score, items[:40]))
    best = max(range(len(scores)), key=lambda i: (scores[i], items[i]["date"]))
    return items[best] if scores[best] >= 0.85 else None

def write(name, h):
    prompt = (f"Write ONE sentence, at most 28 words, that a person could say sincerely at the start of a letter to the office of {name}, "
              f"referring to this news: \"{h['title']}\" ({h['source']}, {h['date']}). Plain and specific. Begin with 'Congratulations on' or 'I saw that'. "
              "No exclamation marks, no 'amazing', 'incredible' or 'awesome', no claims beyond the headline, no questions. Output only the sentence.")
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions",
                                 data=json.dumps({"model": WRITER, "max_tokens": 80, "temperature": 0.3, "messages": [{"role": "user", "content": prompt}]}).encode(),
                                 headers={"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
    j = json.load(urllib.request.urlopen(req, timeout=60))
    line = j["choices"][0]["message"]["content"].strip().strip('"').split("\n")[0].strip()
    return line if 20 < len(line) < 240 else None

def check(line, h):
    q = {"ok": {"type": "noul", "instructions": "Is the sentence an accurate, non-exaggerated reference to the headline, adding no facts the headline does not contain, and free of sarcasm?",
         "criteria": {"true": "The sentence says only what the headline supports, in a sincere, plain register.",
                      "false": "The sentence adds a detail, number, name, or claim the headline does not contain, exaggerates it, or reads as sarcastic or gushing."}}}
    a = jev({"headline": h["title"], "source": h["source"], "date": h["date"], "sentence": line}, q)["ok"]
    return float(a.get("noul") or 0) >= 0.7   # noul answers are a probability, not a choice with a confidence

def compliment(name, state):
    """Returns {line, headline, source, date, url} or None. Never invents; drops anything unverified."""
    items = headlines(name, state)
    h = pick(name, state, items)
    if not h: return None
    line = write(name, h)
    if not line or not check(line, h): return None
    return {"line": line, "headline": h["title"], "source": h["source"], "date": h["date"], "url": h["url"], "made": datetime.date.today().isoformat()}

if __name__ == "__main__":
    name, state = sys.argv[1], sys.argv[2]
    items = headlines(name, state); print(f"{len(items)} headlines")
    c = compliment(name, state); print(json.dumps(c, indent=1) if c else "no usable compliment")
