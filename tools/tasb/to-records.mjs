// Turn the classified TASB harvest into district records the merger accepts.
//
// Two tiers, and the difference is honest rather than cosmetic:
//
//   bans (291 districts) -- "The Board prohibits the use of corporal punishment in the District."
//   That sentence settles it. Nothing else has to be read.
//
//   allows / consent_required -- these adopt TASB's model sentence, which ends "...in accordance with
//   this policy and the Student Code of Conduct" and defers the parent-permission mechanics to a
//   document TASB does not host. The board permits the practice; whether a parent must opt out or opt
//   in is decided elsewhere. Ingram ISD is the proof: FO(LOCAL) says may-be-used, its Code of Conduct
//   requires a parent's verbal approval first. So the note says plainly which document was read and
//   which was not, and the next contributor knows exactly what is missing.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const today = new Date().toISOString().slice(0, 10);

const cls = JSON.parse(readFileSync(join(root, "data/tasb/classified.json"), "utf8"));

// NCES ids, so the merger matches these to districts already on file instead of adding duplicates.
const dir = readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8").split("\n");
const head = dir[0].split(",").map((h) => h.trim().toLowerCase());
const iName = head.indexOf("name"), iState = head.indexOf("state"), iId = head.indexOf("nces_id"), iCounty = head.indexOf("county");
const norm = (n) => n.toLowerCase().replace(/\s+(isd|cisd)$/i, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const byName = {};
for (const line of dir.slice(1)) {
  const c = line.split(",");
  if ((c[iState] || "").trim() !== "TX") continue;
  byName[norm(c[iName] || "")] = { nces_id: (c[iId] || "").trim(), county: (c[iCounty] || "").trim() || null };
}

const out = [];
let held = 0;
for (const r of cls) {
  if (r.decision !== "record" || !r.quote) { held++; continue; }
  const m = byName[norm(r.district)] || {};
  const settled = r.status === "bans";
  out.push({
    state: "TX",
    name: r.district,
    ...(m.nces_id ? { nces_id: m.nces_id } : {}),
    ...(m.county ? { county: m.county } : {}),
    status: r.status,
    source: r.source,
    quote: r.quote,
    policy_code: `FO(LOCAL)`,
    last_verified: today,
    ...(r.date_issued ? { policy_revised: r.date_issued.split("/").reverse().length === 3
        ? `${r.date_issued.split("/")[2]}-${String(r.date_issued.split("/")[0]).padStart(2,"0")}-${String(r.date_issued.split("/")[1]).padStart(2,"0")}`
        : null } : {}),
    notes: settled
      ? `Board policy FO(LOCAL) from TASB Policy Online, read ${today}. The board's own sentence settles this and no further document is needed.`
      : `Board policy FO(LOCAL) from TASB Policy Online, read ${today}. The board permits the practice. FO(LOCAL) defers the parent-permission mechanics to the district's Student Code of Conduct, which TASB does not host and which has NOT been read: whether this district is opt-out (allows) or opt-in (consent_required) is decided there. Ingram ISD is a known case where the two documents differ.`,
  });
}

writeFileSync(join(root, "data/tasb/records.json"), JSON.stringify(out, null, 1));
const by = {};
for (const r of out) by[r.status] = (by[r.status] || 0) + 1;
console.log(`${out.length} records (${held} held below threshold) | ${JSON.stringify(by)}`);
console.log(`with an NCES id: ${out.filter((r) => r.nces_id).length}`);
