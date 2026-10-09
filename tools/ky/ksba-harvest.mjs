// Kentucky's board manuals live on the KSBA policy portal (policy.ksba.org), and the corporal
// punishment policy is always numbered 09.433. The portal is a Telerik/ASP.NET site, but it needs no
// browser: the home page lists every subscribing district with its id, Subscriber.aspx?distid=N
// carries every policy's id for that district inside __VIEWSTATE, and
// Handlers/OnlineDocumentHandler.ashx?id=P&SubscriberId=N hands back the policy as a .docx. This reads
// 09.433 (and any 09.433 procedure) for every Kentucky district the record does not yet quote, then
// runs what it finds through the same clip-and-classify path as everything else.
//
//   node tools/ky/ksba-harvest.mjs [--workers 4]   -> data/handbooks/ksba-ky.jsonl
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { parse as parseYaml } from "yaml";
import { hasAnchor, NOT_THIS } from "../tasb/vocabulary.mjs";
import { reportOps } from "../lib/ops.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const WORKERS = Math.min(4, Number(arg("workers", 4)));
const OUT = join(root, "data/handbooks/ksba-ky.jsonl");
const BASE = "https://policy.ksba.org/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const csvRows = (t) => { const [h, ...rows] = t.trim().split("\n"); const head = h.split(",").map((x) => x.trim().toLowerCase()); const parse = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o; }; return rows.map((l) => Object.fromEntries(head.map((k, i) => [k, (parse(l)[i] ?? "").trim()]))); };
const leas = csvRows(readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8")).filter((r) => r.state === "KY" && r.lea_type.startsWith("Regular public"));
const ky = parseYaml(readFileSync(join(root, "data/districts/KY.yaml"), "utf8"));
const quoted = new Set((Array.isArray(ky) ? ky : ky.districts).filter((r) => r.quote && r.source && ["allows", "bans", "consent_required"].includes(r.status)).map((r) => String(r.nces_id)));
const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).nces_id) : []);
// --only a,b,c re-reads named districts even when the record already quotes them (a handbook is outranked by the board policy).
const only = arg("only", "") ? new Set(arg("only", "").split(",")) : null;
const todo = leas.filter((r) => only ? only.has(r.nces_id) : !quoted.has(r.nces_id) && !done.has(r.nces_id));
console.log(`Kentucky: ${leas.length} regular districts, ${quoted.size} already quoted, ${todo.length} to try on the portal`);

// Polite fetch: one real user agent, 5xx retried with backoff, and a short pause between requests.
async function get(url, { binary = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(45_000) });
      if (r.status >= 500 || r.status === 429) { await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt)); continue; }
      if (!r.ok) return null;
      return binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
    } catch { await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt)); }
  }
  return null;
}

// The home page is a grid of every subscriber: <a onclick="return OpenChapterWindows(146);">Adair County Schools</a>.
const unescape = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"');
const norm = (s) => s.toLowerCase().replace(/\b(schools?|school district|public)\b/g, "").replace(/[^a-z0-9]/g, "");
const home = await get(BASE);
if (!home) { console.error("the portal home page did not answer"); process.exit(1); }
const portal = new Map();
for (const m of home.matchAll(/OpenChapterWindows\((\d+)\);[^>]*>([^<]+)<\/a>/g)) portal.set(norm(unescape(m[2])), { distid: m[1], name: unescape(m[2]).trim() });
console.log(`portal lists ${portal.size} subscribers`);

// Policy ids live in __VIEWSTATE, serialized as "<title>" then "<id>" with the control-byte framing the
// ASP.NET ObjectStateFormatter uses: \x1f\x02\x05<len>TITLE \x1f\x0a\x05<len>ID. Titles read "09.433 - Corporal Punishment".
// The page holds two dropdowns over the same list, so every policy appears twice; keep one per id.
function policiesIn(html) {
  const vs = html.match(/id="__VIEWSTATE" value="([^"]+)"/)?.[1]; if (!vs) return [];
  const raw = Buffer.from(vs, "base64").toString("latin1");
  const out = [];
  for (const m of raw.matchAll(/\x1f\x02\x05[\x00-\xff]{1,2}?(\d\d\.\d[^\x1f]{0,250}?)\x1f\n\x05[\x00-\xff](\d+)\x1f/g)) {
    const title = Buffer.from(m[1], "latin1").toString("utf8").trim();
    const code = title.split(" - ")[0].trim();
    if (!out.some((p) => p.id === m[2])) out.push({ code, title: title.split(" - ").slice(1).join(" - ").trim() || title, id: m[2] });
  }
  return out;
}

// A .docx is a zip; the text is word/document.xml. Read the central directory, inflate that one entry.
function docxText(buf) {
  if (!buf || buf.readUInt32LE(0) !== 0x04034b50) return null;
  let eocd = buf.length - 22; while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) return null;
  let p = buf.readUInt32LE(eocd + 16); const n = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < n && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    if (name === "word/document.xml") {
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const data = buf.subarray(start, start + csize);
      const xml = (method === 8 ? inflateRawSync(data) : data).toString("utf8");
      return unescape(xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, " ").replace(/<w:br[^>]*\/>/g, "\n").replace(/<[^>]+>/g, "")).replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    }
    p += 46 + nl + el + cl;
  }
  return null;
}

const clip = (t) => [...new Set(t.split(/(?<=[.;:])\s+|\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s) && !NOT_THIS.some((n) => s.toLowerCase().includes(n))))];
const revised = (t) => t.match(/Adopted\/Amended:\s*([\d/]+)/i)?.[1] ?? null;

let i = 0, found = 0, rule = 0, notOnPortal = 0, nopolicy = 0, errors = 0;
async function worker() {
  for (;;) {
    const d = todo[i++]; if (!d) return;
    const sub = portal.get(norm(d.name));
    if (!sub) { notOnPortal++; appendFileSync(OUT, JSON.stringify({ nces_id: d.nces_id, name: d.name, error: "not a KSBA policy portal subscriber" }) + "\n"); continue; }
    const manualUrl = `${BASE}Subscriber.aspx?distid=${sub.distid}`;
    const html = await get(manualUrl);
    if (!html) { errors++; appendFileSync(OUT, JSON.stringify({ nces_id: d.nces_id, name: d.name, error: "manual page unreadable", url: manualUrl }) + "\n"); continue; }
    const all = policiesIn(html);
    const cp = all.filter((p) => /^09\.433\b/.test(p.code) || /corporal punishment/i.test(p.title));
    if (!cp.length) { nopolicy++; appendFileSync(OUT, JSON.stringify({ nces_id: d.nces_id, name: d.name, error: all.length ? "no policy 09.433 in the manual" : "no policy list in the manual page", url: manualUrl }) + "\n"); continue; }
    const policies = [];
    for (const p of cp) {
      const url = `${BASE}Handlers/OnlineDocumentHandler.ashx?id=${p.id}&SubscriberId=${sub.distid}`;
      const t = docxText(await get(url, { binary: true }));
      if (t == null) { policies.push({ code: p.code, title: p.title, url, candidates: [], last_revised: null, error: "document unreadable" }); continue; }
      policies.push({ code: p.code, title: p.title, url, candidates: clip(t).slice(0, 40), last_revised: revised(t) });
    }
    if (policies.every((p) => p.error)) { errors++; appendFileSync(OUT, JSON.stringify({ nces_id: d.nces_id, name: d.name, error: "policy document unreadable", url: policies[0].url }) + "\n"); continue; }
    const verdict = policies.some((p) => p.candidates.length) ? "rule" : "silent";
    found++; if (verdict === "rule") rule++;
    appendFileSync(OUT, JSON.stringify({ site: null, nces_id: d.nces_id, district: d.name, _state: "KY", slug: sub.distid, verdict, policies }) + "\n");
    if (found % 25 === 0) console.log(`  ${found} manuals read (${rule} with a rule), ${notOnPortal} not on the portal, ${nopolicy} without 09.433`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
console.log(`done: ${found} manuals read (${rule} rule, ${found - rule} silent), ${notOnPortal} districts not on the portal, ${nopolicy} manuals without 09.433, ${errors} unreadable -> ${OUT}`);
await reportOps({ pass: `ksba-ky-${new Date().toISOString().slice(0, 10)}`, summary: `Mothership read Kentucky board policy 09.433 on the KSBA portal: ${found} districts' policies read, ${notOnPortal} not on the portal`, units: todo.length, produced: found, scope: "KY" });
