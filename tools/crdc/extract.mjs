// Extracts corporal punishment counts from a CRDC public-use file.
// Usage: node extract.mjs <path to SCH/Corporal Punishment.csv> [<path to SCH/Enrollment.csv>] > out.json
// Field names verified against the 2021-22 and 2023-24 files (see data/crdc/README.md). Negative reserve codes are treated as zero.
import { readFileSync } from "node:fs";
const parse = t => { const [h, ...rows] = t.split(/\r?\n/).filter(Boolean).map(l => l.match(/("([^"]|"")*"|[^,]*)/g).filter((_, i) => i % 2 === 0).map(c => c.replace(/^"|"$/g, "").replace(/""/g, '"'))); return rows.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const n = v => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
const rows = parse(readFileSync(process.argv[2], "utf8"));
const sum = (r, re) => Object.keys(r).filter(k => re.test(k)).reduce((a, k) => a + n(r[k]), 0);
const byState = {}, byLea = {};
let schools = 0, leas = new Set(), instances = 0, total = 0, boys = 0, black = 0, wdis = 0;
for (const r of rows) {
  const students = sum(r, /^TOT_DISCWODIS_CORP_[MFX]$/) + sum(r, /^TOT_DISCWDIS_CORP_IDEA_[MFX]$/);
  if (!students) continue;
  schools++; leas.add(r.LEAID); total += students;
  boys += n(r.TOT_DISCWODIS_CORP_M) + n(r.TOT_DISCWDIS_CORP_IDEA_M);
  black += sum(r, /^SCH_DISCWODIS_CORP_BL_[MFX]$/) + sum(r, /^SCH_DISCWDIS_CORP_IDEA_BL_[MFX]$/);
  wdis += sum(r, /^TOT_DISCWDIS_CORP_IDEA_[MFX]$/);
  instances += n(r.SCH_CORPINSTANCES_WODIS) + n(r.SCH_CORPINSTANCES_WDIS);
  const st = r.LEA_STATE; byState[st] = (byState[st] || 0) + students;
  const lea = `${st}|${r.LEAID}|${r.LEA_NAME}`; byLea[lea] = (byLea[lea] || 0) + students;
}
console.log(JSON.stringify({ students: total, instances, boys, black, with_disabilities: wdis, schools, leas: leas.size, byState: Object.fromEntries(Object.entries(byState).sort((a, b) => b[1] - a[1])), topDistricts: Object.entries(byLea).sort((a, b) => b[1] - a[1]).slice(0, 200) }, null, 1));
