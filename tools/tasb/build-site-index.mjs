// The district web index: where each district actually lives, and every policy document found there.
//
// This outlives the question that produced it. The corporal punishment scan needed to know where a
// district publishes its rules; knowing that is the harder half and it answers any policy question
// asked later -- phones, AI, restraint, dress code, attendance. The federal directory gives an address
// from 2023-24 and no newer file exists, so a third of them are dead or moved and nothing refreshes
// them. This does, and records how it knows.
//
// Every row carries its provenance: the address the government lists, the address that actually
// answers, how confident the match was, and for each document how it was found and what it scored.
// A vendor link is the strongest kind of row -- a district linking S=4129 from its own site is
// asserting that manual is theirs, which no name-matching against a federal list can equal.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const jsonl = (p) => existsSync(join(root, p))
  ? readFileSync(join(root, p), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

const walked = jsonl("data/handbooks/site-harvest.jsonl");
const resolved = jsonl("data/handbooks/sites.jsonl");

// The federal directory, for state, NCES id and the address that was listed.
const dir = readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8").split("\n");
const head = dir[0].split(",").map((h) => h.trim().toLowerCase());
const col = (c, n) => c[head.indexOf(n)]?.trim() ?? "";
const key = (n, st) => `${(n || "").toLowerCase().replace(/[^a-z0-9]/g, "")}|${st}`;
const fed = new Map();
for (const line of dir.slice(1)) {
  const c = line.split(","); if (c.length < 4) continue;
  fed.set(key(col(c, "name"), col(c, "state")), { nces_id: col(c, "nces_id"), county: col(c, "county"), listed: col(c, "website"), name: col(c, "name"), state: col(c, "state") });
}

const rows = new Map();
const touch = (name, state) => {
  const k = key(name, state);
  if (!rows.has(k)) {
    const f = fed.get(k) ?? {};
    rows.set(k, { name: f.name ?? name, state: state ?? f.state ?? null, nces_id: f.nces_id ?? null, county: f.county ?? null,
                  listed_website: f.listed ?? null, live_website: null, website_confidence: null, documents: [] });
  }
  return rows.get(k);
};

for (const r of resolved) {
  if (!r.site) continue;
  const row = touch(r.district, r.state);
  row.live_website = r.site;
  row.website_confidence = r.confidence ?? null;
  row.website_found_by = "search, ranked";
}
for (const r of walked) {
  const row = touch(r.district, r.state);
  row.live_website ??= r.website;
  row.website_found_by ??= "federal directory";
  if (r.archived) row.read_from_archive = r.archived;
  for (const d of r.documents ?? []) {
    row.documents.push({
      url: d.url,
      title: d.text || null,
      relevance: d.p ?? null,
      ...(d.vendor ? { vendor: d.vendor, vendor_id: d.site ?? d.district_key ?? d.path ?? null } : {}),
      found: d.via ?? null,
    });
  }
}
for (const row of rows.values()) row.documents.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));

const out = [...rows.values()].sort((a, b) => (a.state ?? "").localeCompare(b.state ?? "") || a.name.localeCompare(b.name));
writeFileSync(join(root, "data/sites/index.json"), JSON.stringify(out, null, 1) + "\n");

const withDocs = out.filter((r) => r.documents.length);
const moved = out.filter((r) => r.live_website && r.listed_website && r.live_website.replace(/\/+$/, "") !== r.listed_website.replace(/\/+$/, ""));
const vendors = {};
for (const r of out) for (const d of r.documents) if (d.vendor) vendors[d.vendor] = (vendors[d.vendor] || 0) + 1;
console.log(`${out.length} districts | ${withDocs.length} with at least one document | ${out.reduce((a, r) => a + r.documents.length, 0)} documents`);
console.log(`${moved.length} are at a different address than the federal directory lists`);
console.log(`vendor manuals located: ${JSON.stringify(vendors)}`);
