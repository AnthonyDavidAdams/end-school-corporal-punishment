"""Shared pieces for the Safe Schools game: where the files live, how the record is read, what a district's
id and enrollment are. Every script in tools/game imports from here so they agree on the numbers.

A district's id is its NCES LEA id when the record has one, otherwise "ST|slug-of-name". Enrollment comes
from the record's own `enrollment` field when a district carries one, else from data/nces/lea-enrollment-2023-24.csv
(summed from the CRDC 2023-24 school enrollment file; rebuilt from tools/crdc/raw/SCH/Enrollment.csv when that
raw file is on disk). A district with no enrollment anywhere counts in the district tallies and is listed as
"enrollment unknown" in the student tallies; it is never guessed."""
import os, sys, csv, json, glob, re, hashlib, datetime, fcntl, tempfile, email.utils

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GAME = os.path.join(ROOT, "data/game")
ENROLLMENT_CSV = os.path.join(ROOT, "data/nces/lea-enrollment-2023-24.csv")
RAW_ENROLLMENT = os.path.join(ROOT, "tools/crdc/raw/SCH/Enrollment.csv")
GEOCODE_CSV = os.path.join(ROOT, "data/nces/lea-geocode-2023-24.csv")
REQUESTS = os.path.join(ROOT, "data/outreach/requests.json")
VICTORIES = os.path.join(ROOT, "data/victories.jsonl")
CORRECTIONS = os.path.join(ROOT, "data/corrections.jsonl")
POLICY_LAG = os.path.join(ROOT, "data/outreach/policy-lag.json")
PERMITTING = ("allows", "consent_required")
os.makedirs(GAME, exist_ok=True)

def now(): return datetime.datetime.now()
def now_iso(): return now().isoformat(timespec="seconds")
def today(): return now().strftime("%Y-%m-%d")

def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"\s*\(\d+\)\s*$", "", str(name or "")).lower()).strip("-")

def district_id(d):
    """NCES id when there is one, else state|slug. Works on a district record or an outreach request."""
    n = d.get("nces_id")
    if n and str(n) not in ("None", "null", ""): return str(n)
    return f"{d.get('state')}|{slug(d.get('name'))}"

def parse_dt(x):
    """ISO (with or without zone) or RFC 2822 -> naive local datetime, or None."""
    if not x or x in ("n/a", "None"): return None
    s = str(x)
    try:
        dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        try: dt = email.utils.parsedate_to_datetime(s)
        except Exception: return None
    if dt.tzinfo is not None: dt = dt.astimezone().replace(tzinfo=None)
    return dt

def band(enrollment):
    """Enrollment band for stratifying experiments and reading tables: tiny, small, mid, large, xl, unknown."""
    if enrollment is None: return "unknown"
    if enrollment < 1000: return "tiny"
    if enrollment < 5000: return "small"
    if enrollment < 20000: return "mid"
    if enrollment < 50000: return "large"
    return "xl"

# ---------------------------------------------------------------- enrollment
def build_enrollment_cache():
    """Sum the CRDC school enrollment file by LEA into data/nces/lea-enrollment-2023-24.csv. Negative values are
    CRDC reserve codes and are skipped, the same rule tools/contacts/build-policy-lag.mjs uses."""
    if not os.path.exists(RAW_ENROLLMENT): return False
    tot = {}
    with open(RAW_ENROLLMENT, newline="", encoding="utf-8", errors="replace") as f:
        rd = csv.DictReader(f)
        for row in rd:
            n = 0
            for k in ("TOT_ENR_M", "TOT_ENR_F", "TOT_ENR_X"):
                try: v = int(float(row.get(k) or 0))
                except ValueError: v = 0
                if v > 0: n += v
            tot[row["LEAID"]] = tot.get(row["LEAID"], 0) + n
    with open(ENROLLMENT_CSV + ".tmp", "w", newline="") as f:
        w = csv.writer(f); w.writerow(["nces_id", "state", "enrollment"])
        for lea in sorted(tot): w.writerow([lea, "", tot[lea]])
    # state column from the directory so the file reads on its own
    st = {}
    try:
        for r in csv.DictReader(open(os.path.join(ROOT, "data/nces/lea-directory-2023-24.csv"))): st[r["nces_id"]] = r["state"]
    except Exception: pass
    rows = list(csv.reader(open(ENROLLMENT_CSV + ".tmp")))[1:]
    with open(ENROLLMENT_CSV + ".tmp", "w", newline="") as f:
        w = csv.writer(f); w.writerow(["nces_id", "state", "enrollment"])
        for lea, _, n in rows: w.writerow([lea, st.get(lea, ""), n])
    os.replace(ENROLLMENT_CSV + ".tmp", ENROLLMENT_CSV)
    return True

_ENR = None
def enrollment_map():
    global _ENR
    if _ENR is None:
        if not os.path.exists(ENROLLMENT_CSV): build_enrollment_cache()
        _ENR = {}
        if os.path.exists(ENROLLMENT_CSV):
            for r in csv.DictReader(open(ENROLLMENT_CSV)):
                try: _ENR[r["nces_id"]] = int(r["enrollment"])
                except ValueError: pass
    return _ENR

_GEO = None
def geocode_map():
    """nces_id -> {county, county_fips, lat, lon} from the NCES EDGE file."""
    global _GEO
    if _GEO is None:
        _GEO = {r["nces_id"]: r for r in csv.DictReader(open(GEOCODE_CSV))} if os.path.exists(GEOCODE_CSV) else {}
    return _GEO

# ---------------------------------------------------------------- the record
_DISTRICTS = None
def load_districts(refresh=False):
    """Every district in data/districts/*.yaml as a flat dict: id, state, name, nces_id, status, county, county_fips,
    enrollment, band, plus the fields the game reads (source, quote, policy_code, crdc_students, legacy_status)."""
    global _DISTRICTS
    if _DISTRICTS is not None and not refresh: return _DISTRICTS
    import yaml
    enr, geo, out = enrollment_map(), geocode_map(), []
    for f in sorted(glob.glob(os.path.join(ROOT, "data/districts/*.yaml"))):
        doc = yaml.safe_load(open(f)) or {}
        st = doc.get("state") or os.path.basename(f)[:2]
        for d in (doc if isinstance(doc, list) else doc.get("districts") or []):
            if not isinstance(d, dict): continue
            nid = str(d["nces_id"]) if d.get("nces_id") else None
            e = d.get("enrollment")
            if e is None and nid: e = enr.get(nid)
            g = geo.get(nid, {}) if nid else {}
            out.append({"id": district_id({"nces_id": nid, "state": st, "name": d.get("name")}), "state": st, "name": d.get("name"),
                        "nces_id": nid, "status": d.get("status") or "unknown", "county": d.get("county") or (g.get("county") or "").replace(" County", "") or None,
                        "county_fips": g.get("county_fips"), "enrollment": e, "band": band(e), "source": d.get("source"), "quote": d.get("quote"),
                        "policy_code": d.get("policy_code"), "crdc_students": d.get("crdc_students_latest"), "legacy_status": d.get("legacy_status"),
                        "contact": d.get("contact") or {}})
    _DISTRICTS = out
    return out

def districts_by_id():
    return {d["id"]: d for d in load_districts()}

def load_states():
    """code -> state law record (status banned | legal | partial, name, year_banned...)."""
    import yaml
    out = {}
    for f in sorted(glob.glob(os.path.join(ROOT, "data/states/*.yaml"))):
        try: s = yaml.safe_load(open(f)) or {}
        except Exception: continue
        if s.get("code"): out[s["code"]] = s
    return out

def load_requests():
    return json.load(open(REQUESTS)) if os.path.exists(REQUESTS) else []

def load_policy_lag():
    return json.load(open(POLICY_LAG)) if os.path.exists(POLICY_LAG) else []

# ---------------------------------------------------------------- jsonl
def read_jsonl(path):
    if not os.path.exists(path): return []
    out = []
    for l in open(path):
        l = l.strip()
        if not l: continue
        try: out.append(json.loads(l))
        except json.JSONDecodeError: pass
    return out

def append_jsonl(path, rows):
    """Append under a lock so two agents writing at once do not interleave lines."""
    if not rows: return
    with open(path + ".lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        with open(path, "a") as f:
            for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")

def write_jsonl(path, rows):
    """Whole-file rewrite: temp file then rename, under the same lock as append."""
    with open(path + ".lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-", suffix=".jsonl")
        with os.fdopen(fd, "w") as f:
            for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
        os.chmod(tmp, 0o644); os.replace(tmp, path)

def write_json(path, obj):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w") as f: json.dump(obj, f, indent=1, ensure_ascii=False)
    os.chmod(tmp, 0o644); os.replace(tmp, path)

def short_hash(*parts, n=12):
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:n]

if __name__ == "__main__":
    if "--build-enrollment" in sys.argv:
        print("built" if build_enrollment_cache() else "raw CRDC enrollment file not on disk; nothing built", ENROLLMENT_CSV)
    ds = load_districts(); e = sum(1 for d in ds if d["enrollment"] is not None)
    print(f"{len(ds)} districts, {e} with enrollment, {len(ds) - e} without; {sum(d['enrollment'] or 0 for d in ds):,} students in the record")
