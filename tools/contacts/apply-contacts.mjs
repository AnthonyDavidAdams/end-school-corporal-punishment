// Write each district's published contact into its record from the state education agencies'
// own directories (data/contacts/*.json). Public record only: the district or superintendent's
// office email as the state publishes it. A contact already on the record is kept unless it has
// no email. Identity: NCES id where the directory carries it (Texas), otherwise name and state,
// and for Georgia the email domain against the district's website in the federal directory.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STOP = new Set(["school","county","district","board","education","public","schools","the","of","city","municipal","consolidated","separate","independent","isd","cisd","inc","dist","sch","co","community","cons","consol","r","i","ii","iii","iv","v","vi","vii","viii","ix","x","xii","xiv","xvi"]);
const tok = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)));
const same = (a, b) => { const A = tok(a), B = tok(b); if (!A.size || !B.size) return false; const inter = [...A].filter((w) => B.has(w)).length; return inter === A.size || inter === B.size; };
const contacts = readdirSync(join(root, "data/contacts")).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync(join(root, "data/contacts", f), "utf8")));
const dir = readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8").split("\n").slice(1).map((l) => l.split(",")).filter((r) => r.length > 4);
const hostOf = (u) => { try { return new URL(u.startsWith("http") ? u : "http://" + u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const byNces = new Map(), byState = {};
for (const c of contacts) { if (!c.district_email) continue; if (c.nces_id) byNces.set(String(c.nces_id), c); (byState[c.state] ||= []).push(c); }
// Georgia: superintendent email domain -> the district whose federal-directory website shares it
const domainToNces = new Map(); for (const r of dir) { const h = hostOf(r[4]); if (h) domainToNces.set(h, r[0]); }
let set = 0, kept = 0, none = 0;
for (const f of readdirSync(join(root, "data/districts")).filter((f) => f.endsWith(".yaml"))) {
  const p = join(root, "data/districts", f); const text = readFileSync(p, "utf8"); const doc = parse(text); let ch = false;
  for (const d of doc.districts ?? []) {
    if (d.contact?.district_email) { kept++; continue; }
    let c = d.nces_id ? byNces.get(String(d.nces_id)) : null;
    if (!c) { const pool = byState[doc.state] || []; const hits = pool.filter((x) => x.name && same(x.name, d.name)); if (hits.length === 1) c = hits[0]; }
    if (!c && doc.state === "GA" && d.nces_id) { const pool = byState.GA || []; c = pool.find((x) => x.domain && domainToNces.get(x.domain) === String(d.nces_id)) ?? null; }
    if (!c) { none++; continue; }
    d.contact = { ...(d.contact || {}), district_email: c.district_email, superintendent: c.superintendent ?? d.contact?.superintendent ?? null, phone: c.phone ?? d.contact?.phone ?? null, contact_source: c.source, as_of: "2026-09-25" };
    set++; ch = true;
  }
  if (ch) writeFileSync(p, text.split("\n").filter((l) => l.startsWith("#")).join("\n") + "\n" + stringify(doc, { lineWidth: 0 }));
}
console.log(`contacts set ${set}, already had ${kept}, no match ${none}`);
