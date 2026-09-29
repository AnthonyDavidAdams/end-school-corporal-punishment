"""Second pass: discipline outcomes from the same survey the struck counts come from.

Out-of-school suspension and expulsion rates per district, 2023-24, against whether the district
struck anyone and whether its policy permits it, within state, with the same controls as correlate.py.
If paddling "keeps order", districts that use it should suspend less, other things equal.
"""
import os, numpy as np, pandas as pd
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); os.chdir(ROOT)
RAW = "tools/crdc/raw"
def tot(df, pat):
    cols = [c for c in df.columns if c.startswith("TOT_") and pat in c and c.rsplit("_", 1)[1] in ("M", "F", "X")]
    x = df[cols].apply(pd.to_numeric, errors="coerce").clip(lower=0).fillna(0); return x.sum(axis=1)
sus = pd.read_csv(f"{RAW}/SCH/Suspensions.csv", dtype={"LEAID": str}, low_memory=False, encoding="latin-1")
sus["oos"] = tot(sus, "DISCWODIS_SINGOOS") + tot(sus, "DISCWODIS_MULTOOS") + tot(sus, "DISCWDIS_SINGOOS") + tot(sus, "DISCWDIS_MULTOOS")
sus["iss"] = tot(sus, "DISCWODIS_ISS") + tot(sus, "DISCWDIS_ISS")
exp = pd.read_csv(f"{RAW}/SCH/Expulsions.csv", dtype={"LEAID": str}, low_memory=False, encoding="latin-1")
exp["expul"] = tot(exp, "DISCWODIS_EXP") + tot(exp, "DISCWDIS_EXP")
enr = pd.read_csv(f"{RAW}/SCH/Enrollment.csv", dtype={"LEAID": str}, low_memory=False, encoding="latin-1")
enr["enr"] = tot(enr, "ENR")
lea = (sus.groupby("LEAID")[["oos", "iss"]].sum().join(exp.groupby("LEAID")[["expul"]].sum()).join(enr.groupby("LEAID")[["enr"]].sum())).reset_index().rename(columns={"LEAID": "nces_id"})
lea["nces_id"] = lea.nces_id.str.zfill(7)
d = pd.read_csv("data/outcomes/joined-2023-24.csv", dtype={"nces_id": str}).merge(lea, on="nces_id", how="inner")
d = d[d.enr >= 100].copy()
d["oos_rate"] = 100 * d.oos / d.enr; d["iss_rate"] = 100 * d.iss / d.enr; d["exp_rate"] = 1000 * d.expul / d.enr
def ols(y, X):
    X = np.column_stack([np.ones(len(X)), X]).astype(float); b = np.linalg.lstsq(X, y, rcond=None)[0]
    r = y - X @ b; n, k = X.shape; cov = ((r @ r) / (n - k)) * np.linalg.pinv(X.T @ X); return b, np.sqrt(np.diag(cov))
def design(df, focal):
    S = pd.get_dummies(df.state, drop_first=True).astype(float); Z = df[["perfrl", "perblk", "perhsp", "rural", "town"]].astype(float).copy(); Z["logenr"] = np.log(df.enr.clip(lower=10))
    return np.column_stack([focal, Z.values, S.values])
print(f"Districts with discipline data, enrollment ≥100, in the 17 states: {len(d):,}; struck ≥1: {int(d.hits.sum())}")
for y, label in (("oos_rate", "out-of-school suspensions per 100 students"), ("iss_rate", "in-school suspensions per 100"), ("exp_rate", "expulsions per 1,000")):
    raw = d.groupby("hits")[y].mean(); b, se = ols(d[y].values, design(d, d.hits.values.reshape(-1, 1)))
    print(f"\n{label}\n   struck ≥1: {raw[1]:.2f}   none: {raw[0]:.2f}   adjusted difference: {b[1]:+.3f} (se {se[1]:.3f}, t = {b[1]/se[1]:+.1f})")
    p = d[d.status.isin(["allows", "consent_required", "bans"])].copy(); p["permits"] = (p.status != "bans").astype(int)
    b3, se3 = ols(p[y].values, design(p, p.permits.values.reshape(-1, 1)))
    print(f"   policy permits vs prohibits (n={len(p):,}): {b3[1]:+.3f} (se {se3[1]:.3f}, t = {b3[1]/se3[1]:+.1f})")
d.to_csv("data/outcomes/joined-discipline-2023-24.csv", index=False)
