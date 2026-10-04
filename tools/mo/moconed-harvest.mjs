// Missouri's board manuals live on the MSBA policy portal, one server-rendered page per district, and
// the corporal punishment policy is always number 2670. This reads it for every Missouri district the
// record does not yet quote, by guessing the portal slug from the district's name (the portal has no
// index), then runs what it finds through the same clip-and-classify path as everything else.
//
//   node tools/mo/moconed-harvest.mjs [--workers 6]   -> data/handbooks/moconed-mo.jsonl (+ slugs map)
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { hasAnchor, NOT_THIS } from "../tasb/vocabulary.mjs";
import { reportOps } from "../lib/ops.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const WORKERS = Number(arg("workers", 6));
const OUT = join(root, "data/handbooks/moconed-mo.jsonl");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const csvRows = (t) => { const [h, ...rows] = t.trim().split("\n"); const head = h.split(",").map((x) => x.trim().toLowerCase()); const parse = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o; }; return rows.map((l) => Object.fromEntries(head.map((k, i) => [k, (parse(l)[i] ?? "").trim()]))); };
const leas = csvRows(readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8")).filter((r) => r.state === "MO" && r.lea_type.startsWith("Regular public"));
const mo = parseYaml(readFileSync(join(root, "data/districts/MO.yaml"), "utf8"));
const quoted = new Set((Array.isArray(mo) ? mo : mo.districts).filter((r) => r.quote && r.source && ["allows", "bans", "consent_required"].includes(r.status)).map((r) => String(r.nces_id)));
const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).nces_id) : []);
const todo = leas.filter((r) => !quoted.has(r.nces_id) && !done.has(r.nces_id));
console.log(`Missouri: ${leas.length} regular districts, ${quoted.size} already quoted, ${todo.length} to try on the portal`);

// Slug guesses. The portal writes "Scott County R-IV" as ScottCountyRIV and "Puxico R-VIII" as
// PuxicoRVIII; the directory writes SCOTT CO. R-IV and PUXICO R-VIII. Try the obvious spellings.
const title = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
function slugs(name) {
  const base = title(name).replace(/\s*\(.*?\)\s*/g, " ").replace(/\./g, "").trim();
  const variants = new Set();
  const add = (s) => variants.add(s.replace(/[^A-Za-z0-9]/g, ""));
  add(base); add(base.replace(/\bCo\b/g, "County")); add(base.replace(/\bCounty\b/g, "Co"));
  add(base.replace(/\bSch(ool)? Dist(rict)?\b/g, "")); add(base.replace(/\bSchool District\b/g, "")); add(base.replace(/\bPublic Schools?\b/g, ""));
  add(base.replace(/\bR[- ]?([IVX]+)\b/g, "R$1")); add(base.replace(/\bC[- ]?(\d+)\b/g, "C$1"));
  add(base.replace(/\bCo\b/g, "County").replace(/\bSchool District\b/g, ""));
  return [...variants].filter(Boolean);
}
const clip = (t) => [...new Set(t.split(/(?<=[.;:])\s+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s) && !NOT_THIS.some((n) => s.toLowerCase().includes(n))))];
const text = (html) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

async function get(url) { try { const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) }); if (!r.ok) return null; return await r.text(); } catch { return null; } }

let i = 0, found = 0, noslug = 0, nopolicy = 0;
async function worker() {
  for (;;) {
    const d = todo[i++]; if (!d) return;
    let slug = null, page = null;
    for (const s of slugs(d.name)) { const h = await get(`https://www.moconed.com/district/${s}/district.php`); if (h && h.includes("pol=")) { slug = s; page = h; break; } }
    if (!slug) { noslug++; appendFileSync(OUT, JSON.stringify({ nces_id: d.nces_id, name: d.name, slug: null, error: "no portal page under any guessed slug" }) + "\n"); continue; }
    const m = page.match(/2670<\/div><div class="tab2"><a href="district\.php\?pol=(\d+)">([^<]*)<\/a>/);
    if (!m) { nopolicy++; appendFileSync(OUT, JSON.stringify({ nces_id: d.nces_id, name: d.name, slug, error: "no policy 2670 in the manual" }) + "\n"); continue; }
    const url = `https://www.moconed.com/district/${slug}/district.php?pol=${m[1]}`;
    const ph = await get(url); if (!ph) { appendFileSync(OUT, JSON.stringify({ nces_id: d.nces_id, name: d.name, slug, error: "policy page unreadable", url }) + "\n"); continue; }
    const t = text(ph); const start = t.indexOf("2670"); const body = t.slice(Math.max(0, start), start + 6000);
    const cands = clip(body);
    found++;
    appendFileSync(OUT, JSON.stringify({ site: null, nces_id: d.nces_id, district: d.name, _state: "MO", slug, verdict: cands.length ? "rule" : "silent", policies: [{ code: "2670", title: m[2].trim(), url, candidates: cands.slice(0, 40), last_revised: null }] }) + "\n");
    if (found % 25 === 0) console.log(`  ${found} policies read, ${noslug} no page, ${nopolicy} no 2670`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
console.log(`done: ${found} policy pages read, ${noslug} districts with no portal page under any guessed slug, ${nopolicy} manuals without 2670 -> ${OUT}`);
await reportOps({ pass: `moconed-mo-${new Date().toISOString().slice(0, 10)}`, summary: `Mothership read Missouri board policy 2670 on the MSBA portal: ${found} districts' policies read, ${noslug} not found`, units: todo.length, produced: found, scope: "MO" });
