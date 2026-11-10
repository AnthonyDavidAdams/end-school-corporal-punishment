#!/usr/bin/env python3
"""Writes data/crdc/2023-24/lea-reported.csv: for every district in the federal file, what it actually
answered about corporal punishment. A district missing from districts.csv has no student counted as
struck, which is not the same as having told the government it does not use it: 1,611 schools carry a
missing-data code. A letter may say "the district reported no use" only for a row here where every school
either answered No or was not asked (-9, not applicable: a preschool, a virtual school), at least one
answered No, and no student is counted. -5 and -11 are missing data and count as not answered.
Usage: python3 tools/crdc/reported.py [path to 2023-24-crdc-data.zip]"""
import zipfile, csv, io, os, sys, collections
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tools/crdc/raw/2023-24-crdc-data.zip")
z = zipfile.ZipFile(src)
rd = csv.DictReader(io.TextIOWrapper(z.open("SCH/Corporal Punishment.csv"), encoding="latin-1"))
tot = [c for c in rd.fieldnames if c.startswith("TOT_DISCWODIS_CORP_") or c.startswith("TOT_DISCWDIS_CORP_IDEA_")]
L = collections.OrderedDict()
for row in rd:
    d = L.setdefault(row["LEAID"], {"state": row["LEA_STATE"], "schools": 0, "answered_no": 0, "answered_yes": 0, "not_applicable": 0, "not_answered": 0, "students": 0})
    d["schools"] += 1
    a = (row["SCH_CORP_IND"] or "").strip().lower()
    d["answered_no" if a == "no" else "answered_yes" if a == "yes" else "not_applicable" if a == "-9" else "not_answered"] += 1
    for c in tot:
        try: v = int(row[c])
        except ValueError: v = 0
        if v > 0: d["students"] += v
clean = lambda d: d["answered_no"] >= 1 and d["answered_no"] + d["not_applicable"] == d["schools"] and d["students"] == 0
out = os.path.join(ROOT, "data/crdc/2023-24/lea-reported.csv")
with open(out + ".tmp", "w", newline="") as f:
    w = csv.writer(f, lineterminator="\n"); w.writerow(["state", "nces_id", "schools", "answered_no", "answered_yes", "not_applicable", "not_answered", "students", "reported_no_use"])
    for k, d in L.items(): w.writerow([d["state"], k, d["schools"], d["answered_no"], d["answered_yes"], d["not_applicable"], d["not_answered"], d["students"], int(clean(d))])
os.replace(out + ".tmp", out)
n = sum(1 for d in L.values() if clean(d))
print(f"{len(L)} districts; {n} reported no use (No at every school that was asked, no student counted); {sum(d['students'] for d in L.values())} students in all")
