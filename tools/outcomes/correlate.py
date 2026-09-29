"""Do districts that hit children do worse? A first, honest pass.

Joins three things by federal district id: the 2023-24 civil rights survey counts of students struck
(our extract), the district's own written rule from the record, and Stanford's SEDA 6.0 district
achievement means (grades 3-8, math and reading, on one national scale) with its covariates.

Two comparisons, both within state, both adjusted for the things that travel with the practice:
poverty (free/reduced lunch share), race (Black and Hispanic shares), locale (rural, town) and size.
  1. Districts that struck at least one child vs districts that struck none.
  2. Districts whose own policy permits the practice vs districts whose policy prohibits it.

None of this is causal. Districts that paddle are poorer, more rural and more Southern; the controls
take out the part of that we can measure and nothing else. What survives is a correlation worth
reporting with its size and its uncertainty, next to the literature that has done this properly.

    tools/.venv/bin/python tools/outcomes/correlate.py
"""
import json, subprocess, os
import numpy as np, pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(ROOT)

cp = pd.read_csv("data/crdc/2023-24/districts.csv", dtype={"nces_id": str}).rename(columns={"students": "cp_students"})
rec = subprocess.run(["node", "-e", '''
const yaml=require("./tools/node_modules/yaml");const fs=require("fs");const out=[];
for(const f of fs.readdirSync("data/districts").filter(f=>f.endsWith(".yaml"))){const d=yaml.parse(fs.readFileSync("data/districts/"+f,"utf8"));for(const r of (Array.isArray(d)?d:d.districts))if(r.nces_id)out.push({nces_id:String(r.nces_id),status:r.status||"unknown"});}
console.log(JSON.stringify(out));'''], capture_output=True, text=True).stdout
pol = pd.DataFrame(json.loads(rec))

s = pd.read_csv("data/outcomes/seda_geodist_pool_gcs_6.0.csv", dtype={"sedalea": str}, low_memory=False)
s = s[(s.subgroup == "all") & (s.gap == 0)][["sedalea", "stateabb", "gcs_mn_avg_ol", "gcs_mn_avg_ol_se", "tot_asmts"]]
s = s.rename(columns={"sedalea": "nces_id", "stateabb": "state", "gcs_mn_avg_ol": "ach"})
c = pd.read_csv("data/outcomes/seda_cov_geodist_pool_6.0.csv", dtype={"sedalea": str}, low_memory=False)
c = c[["sedalea", "perfrl", "perblk", "perhsp", "rural", "town", "totenrl"]].rename(columns={"sedalea": "nces_id"})
d = s.merge(c, on="nces_id", how="left")

states = json.load(open("site/data/states.json"))
legal = [k for k, v in states.items() if v["status"] in ("legal", "partial")]
d = d[d.state.isin(legal)].copy()
d = d.merge(cp[["nces_id", "cp_students"]], on="nces_id", how="left").merge(pol, on="nces_id", how="left")
d["cp_students"] = d.cp_students.fillna(0)
d["hits"] = (d.cp_students > 0).astype(int)
d["cp_rate"] = 1000 * d.cp_students / d.totenrl.replace(0, np.nan)
d = d.dropna(subset=["ach", "perfrl", "perblk", "rural", "totenrl"])
print(f"Districts in the 17 permitting states with achievement and covariates: {len(d):,}")
print(f"  struck at least one child in 2023-24: {int(d.hits.sum())}")


def ols(y, X):
    X = np.column_stack([np.ones(len(X)), X]).astype(float)
    b = np.linalg.lstsq(X, y, rcond=None)[0]
    r = y - X @ b; n, k = X.shape
    cov = ((r @ r) / (n - k)) * np.linalg.pinv(X.T @ X)
    return b, np.sqrt(np.diag(cov))


def design(df, focal):
    S = pd.get_dummies(df.state, drop_first=True).astype(float)
    Z = df[["perfrl", "perblk", "perhsp", "rural", "town"]].astype(float).copy()
    Z["logenr"] = np.log(df.totenrl.clip(lower=10))
    return np.column_stack([focal, Z.values, S.values])


raw = d.groupby("hits").ach.mean()
print(f"\n1. STRUCK vs NOT (achievement in grade-levels relative to the national average)")
print(f"   raw:      struck {raw[1]:+.2f}   none {raw[0]:+.2f}   gap {raw[1]-raw[0]:+.2f}")
b, se = ols(d.ach.values, design(d, d.hits.values.reshape(-1, 1)))
print(f"   adjusted: {b[1]:+.3f} grade-levels (se {se[1]:.3f}, t = {b[1]/se[1]:+.1f})  [state fixed effects + poverty, race, locale, size]")
dd = d[d.cp_rate.notna() & (d.cp_rate > 0)]
b2, se2 = ols(dd.ach.values, design(dd, np.log(dd.cp_rate.values).reshape(-1, 1)))
print(f"   dose, among districts that struck anyone (n={len(dd)}): {b2[1]:+.3f} per log(students struck per 1,000) (se {se2[1]:.3f}, t = {b2[1]/se2[1]:+.1f})")

p = d[d.status.isin(["allows", "consent_required", "bans"])].copy()
p["permits"] = (p.status != "bans").astype(int)
rawp = p.groupby("permits").ach.mean()
print(f"\n2. POLICY PERMITS vs PROHIBITS (quoted rules only; n={len(p):,}, permits {int(p.permits.sum())}, prohibits {int((1-p.permits).sum())})")
print(f"   raw:      permits {rawp[1]:+.2f}   prohibits {rawp[0]:+.2f}   gap {rawp[1]-rawp[0]:+.2f}")
b3, se3 = ols(p.ach.values, design(p, p.permits.values.reshape(-1, 1)))
print(f"   adjusted: {b3[1]:+.3f} grade-levels (se {se3[1]:.3f}, t = {b3[1]/se3[1]:+.1f})")

print("\nWHO GETS STRUCK (district means; the confounding, in numbers)")
print(d.groupby("hits")[["perfrl", "perblk", "rural", "totenrl", "ach"]].mean().round(3).rename(index={0: "none", 1: "struck ≥1"}).to_string())

print("\nBY STATE, adjusted gap struck-vs-not where both groups exist (n ≥ 30 each):")
for st, g in d.groupby("state"):
    if g.hits.sum() >= 30 and (1 - g.hits).sum() >= 30:
        Z = g[["perfrl", "perblk", "perhsp", "rural", "town"]].astype(float).copy(); Z["logenr"] = np.log(g.totenrl.clip(lower=10))
        bb, ss = ols(g.ach.values, np.column_stack([g.hits.values, Z.values]))
        print(f"   {st}: {bb[1]:+.3f} (se {ss[1]:.3f})  struck {int(g.hits.sum())} / none {int((1-g.hits).sum())}")

d.to_csv("data/outcomes/joined-2023-24.csv", index=False)
print("\nwrote data/outcomes/joined-2023-24.csv")
