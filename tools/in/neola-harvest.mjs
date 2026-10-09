// Indiana's board manuals are Neola manuals, and Neola hosts them three ways. This reads policy 5630
// "Corporal Punishment" (plus 5630.01 and 5600, and anything titled corporal punishment) for every
// Indiana district the record does not yet quote, then runs what it finds through the same
// clip-and-classify path as everything else.
//
// Where the manuals live (measured 2026-10-09):
//   BoardDocs      https://go.boarddocs.com/in/<slug>/Board.nsf/Public, a JavaScript shell whose data
//                  comes from three POST endpoints: BD-GetPolicyBooks (book names), BD-GetPolicies
//                  {status, book} (code, title and item id per policy), BD-GetPolicyItem {id} (the
//                  policy with its Adopted/Revised rows). The citable URL is Board.nsf/goto?open&id=<id>.
//                  Plain requests get a 403 or a 404 page; a browser Accept header gets the real thing.
//   go.neola.com   https://go.neola.com/<slug>-in/policy/<book>/po5630, server-rendered HTML with the
//                  manual's table of contents at /policy/<book>.
//   files.neola.com https://files.neola.com/<slug>-in/search/policies/po5630.htm, static files with no
//                  index (directory listings are denied), so the three codes are probed directly.
//
// Nobody publishes a slug list, so each district's manual is found by walking its own website for a
// vendor link (the district asserting which manual is its own), then by guessing slugs from the name
// and checking the manual names the district, then by one Brave search. The slug map is cached so a
// re-run skips discovery.
//
//   node tools/in/neola-harvest.mjs [--workers 4] [--limit N] [--only <nces_id>]
//     -> data/handbooks/neola-in.jsonl (+ data/handbooks/neola-in-slugs.json)
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { hasAnchor, NOT_THIS } from "../tasb/vocabulary.mjs";
import { reportOps } from "../lib/ops.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const WORKERS = Math.min(4, Number(arg("workers", 4)));
const LIMIT = Number(arg("limit", 0));
const ONLY = arg("only", null);
const OUT = join(root, "data/handbooks/neola-in.jsonl");
const SLUGS = join(root, "data/handbooks/neola-in-slugs.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CODES = ["5630", "5630.01", "5600"];
// Which policies to read. Neola numbering by code, and by title for manuals that are not Neola's
// (Avon's 5600 is "Guidance and Counseling"; its discipline rules live under another number).
const WANT = /corporal|student discipline|discipline of students|student conduct|code of conduct/i;
const wanted = (code, title) => code === "5630" || code === "5630.01" || (code === "5600" ? /discipline|conduct/i.test(title) : WANT.test(title));

const csvRows = (t) => { const [h, ...rows] = t.trim().split("\n"); const head = h.split(",").map((x) => x.trim().toLowerCase()); const parse = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o; }; return rows.map((l) => Object.fromEntries(head.map((k, i) => [k, (parse(l)[i] ?? "").trim()]))); };
const leas = csvRows(readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8")).filter((r) => r.state === "IN" && r.lea_type.startsWith("Regular public"));
const yml = parseYaml(readFileSync(join(root, "data/districts/IN.yaml"), "utf8"));
const quoted = new Set((Array.isArray(yml) ? yml : yml.districts).filter((r) => r.quote && r.source && ["allows", "bans", "consent_required"].includes(r.status)).map((r) => String(r.nces_id)));
const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).nces_id) : []);
let todo = leas.filter((r) => !quoted.has(r.nces_id) && !done.has(r.nces_id) && (!ONLY || r.nces_id === ONLY));
if (LIMIT) todo = todo.slice(0, LIMIT);
const slugs = existsSync(SLUGS) ? JSON.parse(readFileSync(SLUGS, "utf8")) : {};
const saveSlugs = () => writeFileSync(SLUGS, JSON.stringify(slugs, null, 1) + "\n");
console.log(`Indiana: ${leas.length} regular districts, ${quoted.size} already quoted, ${done.size} already tried, ${todo.length} to try`);

// ---- polite HTTP: browser headers, 30 s timeout, 5xx/429 retried with backoff, never more than WORKERS in flight
async function get(url, { method = "GET", body = null, accept = "text/html,application/xhtml+xml,*/*;q=0.8" } = {}) {
  const headers = { "user-agent": UA, accept, "accept-language": "en-US,en;q=0.9" };
  if (body) { headers["content-type"] = "application/x-www-form-urlencoded"; headers["x-requested-with"] = "XMLHttpRequest"; }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { method, headers, body, redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (r.status >= 500 || r.status === 429) { await new Promise((z) => setTimeout(z, 2000 * 2 ** attempt)); continue; }
      return { status: r.status, url: r.url, text: r.ok ? decode(await r.arrayBuffer(), r.headers.get("content-type") || "") : "" };
    } catch (err) { if (attempt === 3) return { status: 0, url, text: "", error: String(err.message || err) }; await new Promise((z) => setTimeout(z, 2000 * 2 ** attempt)); }
  }
  return { status: 0, url, text: "" };
}

// files.neola.com serves its static policies as Windows-1252 with no charset header, so the Board's
// apostrophe (0x92) decoded as U+FFFD and the quote was no longer verbatim. UTF-8 when it is valid
// UTF-8; otherwise the charset the header or a meta tag names, or Windows-1252.
function decode(buf, contentType) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch {}
  const head = new TextDecoder("latin1").decode(buf.slice(0, 2048));
  const cs = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] || /charset=["']?([\w-]+)/i.exec(head)?.[1] || "windows-1252";
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}
// The specific policy first: 5630 is the corporal punishment rule, 5600's one mention of it is a
// clause in a list of sanctions, and the classifier chooses from the pool in this order.
const ORDER = (p) => { const i = CODES.indexOf(p.code); return i < 0 ? CODES.length : i; };
const sorted = (ps) => [...ps].sort((a, b) => ORDER(a) - ORDER(b));
const text = (html) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&quot;|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
// Sentences, as in the Missouri reader, plus a split at line ends and after a closing quote: Neola sets
// "Corporal Punishment" as a heading line above the rule sentence, and the definition ends in a quote
// mark, so splitting only after . ; : glued heading, definition and rule into one candidate.
const clip = (t) => [...new Set(t.split(/(?<=[.;:]["\u201d']?)\s+|\n+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s) && !NOT_THIS.some((n) => s.toLowerCase().includes(n))))];
const links = (html, base) => { const out = []; for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) { let h = m[1].replace(/&amp;/g, "&"); try { h = new URL(h, base).href; } catch { continue; } out.push({ h, t: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }); } return out; };

// ---- identity: a guessed or searched manual must name the district
const STOP = new Set(["school", "schools", "schl", "schls", "sch", "corp", "corporation", "community", "comm", "com", "consolidated", "con", "cons", "district", "dist", "public", "city", "county", "co", "inc", "the", "of", "msd", "metropolitan", "united", "unified", "area", "central", "north", "south", "east", "west", "township", "twp"]);
const tokens = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
const names = (name) => { const strong = tokens(name).filter((t) => !STOP.has(t) && t.length > 2); const weak = tokens(name).filter((t) => ["north", "south", "east", "west", "central", "county", "township"].includes(t)); return { strong, weak }; };
function namesDistrict(pageText, name) {
  const t = " " + tokens(pageText).join(" ") + " ";
  const { strong, weak } = names(name);
  const keys = strong.length ? strong : weak; if (!keys.length) return false;
  const hits = keys.filter((k) => t.includes(" " + k + " ")).length;
  if (hits < Math.max(1, Math.ceil(keys.length * 0.6))) return false;
  // "North Harrison" must not match "South Harrison": a direction in the name has to appear too.
  return weak.every((w) => !["north", "south", "east", "west"].includes(w) || t.includes(" " + w + " "));
}

// ---- the three hosts
const VENDOR = /go\.boarddocs\.com\/in\/([a-z0-9_-]+)|go\.neola\.com\/([a-z0-9-]+-in)\b|(?:files|www)\.neola\.com\/([a-z0-9-]+-in)\b/i;
const vendorOf = (url) => { const m = VENDOR.exec(url); if (!m) return null; return m[1] ? { host: "boarddocs", slug: m[1].toLowerCase() } : m[2] ? { host: "neola", slug: m[2].toLowerCase() } : { host: "files", slug: m[3].toLowerCase() }; };
const landing = (v) => v.host === "boarddocs" ? `https://go.boarddocs.com/in/${v.slug}/Board.nsf/Public` : v.host === "neola" ? `https://go.neola.com/${v.slug}/policy` : `https://files.neola.com/${v.slug}/search/policies/po0000.htm`;

// Cities with more than one Indiana district. "Fort Wayne Community Schools" matched Northwest Allen
// County's BoardDocs page because that page's address line says Fort Wayne; an address-line match is
// only trusted where the city has one district.
const crowded = new Set(Object.entries(leas.reduce((a, r) => { const c = r.city.toLowerCase(); a[c] = (a[c] || 0) + 1; return a; }, {})).filter(([, n]) => n > 1).map(([c]) => c));
const cityOnly = (name) => { const strong = tokens(name).filter((t) => !STOP.has(t) && t.length > 2); return [...crowded].some((c) => { const ct = tokens(c); return strong.length && strong.every((t) => ct.includes(t)); }); };

// A BoardDocs slug that no longer answers usually means the district moved to Neola's own host under
// the same slug: go.boarddocs.com/in/brco is gone and go.neola.com/brco-in is Brown County Schools.
const twins = (v) => v.host === "boarddocs" && !/-in$/.test(v.slug) ? [v, { host: "neola", slug: `${v.slug}-in` }, { host: "files", slug: `${v.slug}-in` }] : [v];
// The district's own link is its own assertion, so the slug it names needs only to answer; a twin
// guessed from it is checked by name like any other guess.
async function verifyAny(v, name, trust = false) { const ts = twins(v); for (let i = 0; i < ts.length; i++) if (await verify(ts[i], name, trust && i === 0)) return ts[i]; return null; }

// Verify a vendor site is this district's: the landing page must name it. For files.neola.com, whose
// landing is a policy page, any of the three codes will do.
async function verify(v, name, trust = false) {
  const urls = v.host === "files" ? CODES.map((c) => `https://files.neola.com/${v.slug}/search/policies/po${c}.htm`) : [landing(v)];
  for (const u of urls) {
    const r = await get(u); if (r.status !== 200 || !r.text || /bd404|Oops! The page/i.test(r.text)) continue;
    if (trust) return true;
    if (v.host !== "boarddocs") { if (namesDistrict(text(r.text).slice(0, 4000), name)) return true; continue; }
    // A BoardDocs page names its organization in SiteTitle2 or the meta description when it names it
    // at all; <title> and SiteTitle1 are the street address, which is enough only where the city is
    // not shared with another district.
    const org = [...r.text.matchAll(/id="SiteTitle2"[^>]*>([^<]*)/g)].map((m) => m[1]).concat([...r.text.matchAll(/<meta name="DESCRIPTION" content="([^"]*)"/gi)].map((m) => m[1])).join(" ");
    if (namesDistrict(org, name)) return true;
    const addr = [...r.text.matchAll(/id="SiteTitle1"[^>]*>([^<]*)/g)].map((m) => m[1]).concat([...r.text.matchAll(/<title>([^<]*)/gi)].map((m) => m[1])).join(" ");
    if (namesDistrict(addr, name) && !cityOnly(name)) return true;
  }
  return false;
}

// BoardDocs. Books, then the policy list of each book that looks like policies, then the items.
async function readBoardDocs(slug) {
  const base = `https://go.boarddocs.com/in/${slug}/Board.nsf`;
  const bk = await get(`${base}/BD-GetPolicyBooks?open&${Math.random()}`, { method: "POST", body: "", accept: "*/*" });
  if (bk.status !== 200) return { error: `BoardDocs books ${bk.status || bk.error}`, url: `${base}/Public` };
  let books = [...bk.text.matchAll(/class="dropdown-item"[^>]*title="([^"]+)"/g)].map((m) => m[1]);
  if (!books.length) books = [""];
  const pref = books.filter((b) => /polic|bylaw/i.test(b)); const order = pref.length ? pref : books;
  const picks = [];
  for (const book of order) {
    const pl = await get(`${base}/BD-GetPolicies?open&${Math.random()}`, { method: "POST", body: new URLSearchParams({ status: "active", book }).toString(), accept: "*/*" });
    if (pl.status !== 200) continue;
    for (const m of pl.text.matchAll(/unique=\s*"([A-Z0-9]+)"[^>]*>\s*<div>\s*<b>([^<]*)<\/b>\s*<\/div>\s*<div>([^<]*)/g)) {
      const code = m[2].trim().replace(/^po/i, ""), title = m[3].trim();
      if (wanted(code, title) && picks.length < 8) picks.push({ id: m[1], code, title, book });
    }
    if (picks.length) break;
  }
  if (!picks.length) return { error: "no policy 5630/5630.01/5600 and none titled corporal punishment or student discipline in the manual", url: `${base}/Public` };
  const policies = [];
  for (const p of sorted(picks)) {
    const it = await get(`${base}/BD-GetPolicyItem?open&${Math.random()}`, { method: "POST", body: new URLSearchParams({ id: p.id }).toString(), accept: "*/*" });
    const url = `${base}/goto?open&id=${p.id}`;
    if (it.status !== 200 || !it.text) { policies.push({ code: p.code, title: p.title, url, candidates: [], last_revised: null, error: `item ${it.status}` }); continue; }
    const rows = Object.fromEntries([...it.text.matchAll(/<div class="col leftcol">([^<]+)<\/div><div class="col rightcol[^"]*">([\s\S]*?)<\/div>/g)].map((m) => [m[1].trim().toLowerCase(), text(m[2]).trim()]));
    const bodyAt = it.text.search(/id\s*=\s*"forcopy"/); const body = text(bodyAt >= 0 ? it.text.slice(it.text.indexOf(">", bodyAt) + 1) : it.text);
    policies.push({ code: p.code, title: p.title, url, candidates: clip(body).slice(0, 40), last_revised: rows["last revised"] || rows["revised"] || null, adopted: rows["adopted"] || null });
  }
  return { policies };
}

// go.neola.com. The /policy page lists books; each book page lists policies; each policy is a page.
async function readNeola(slug) {
  const base = `https://go.neola.com/${slug}`;
  const idx = await get(`${base}/policy`);
  if (idx.status !== 200) return { error: `go.neola.com ${idx.status || idx.error}`, url: `${base}/policy` };
  let books = [...new Set(links(idx.text, idx.url).map((l) => l.h).filter((h) => new RegExp(`^${base}/policy/[a-z0-9-]+$`).test(h)))];
  const pref = books.filter((b) => /polic|bylaw/i.test(b.split("/").pop())); const order = pref.length ? pref : books;
  const picks = [];
  for (const book of order) {
    const bp = await get(book); if (bp.status !== 200) continue;
    for (const l of links(bp.text, bp.url)) {
      const m = new RegExp(`^${book}/po(\\d+(?:\\.\\d+)?)$`).exec(l.h); if (!m) continue;
      const title = l.t.replace(/^po?\s*\d+(\.\d+)?\s*[-–:]?\s*/i, "").trim();
      if (wanted(m[1], title) && picks.length < 8) picks.push({ url: l.h, code: m[1], title });
    }
    if (picks.length) break;
  }
  if (!picks.length) return { error: "no policy 5630/5630.01/5600 in the manual", url: `${base}/policy` };
  const policies = [];
  for (const p of sorted(picks)) {
    const pg = await get(p.url);
    if (pg.status !== 200) { policies.push({ code: p.code, title: p.title, url: p.url, candidates: [], last_revised: null, error: `policy ${pg.status}` }); continue; }
    const art = /<article class="policy-content"[^>]*>([\s\S]*?)<\/article>/.exec(pg.text);
    const t = text(art ? art[1] : pg.text);
    const h = /<h1 class="policy-title"[^>]*>([\s\S]*?)<\/h1>/.exec(pg.text);
    const title = h ? text(h[1]).replace(/^\d+(\.\d+)?\s*[-–:]?\s*/, "") : p.title;
    const meta = text(pg.text);
    const revised = /(?:Last\s+)?Revised\s+([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(meta), adopted = /Adopted\s+([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(meta);
    policies.push({ code: p.code, title, url: p.url, candidates: clip(t).slice(0, 40), last_revised: revised ? revised[1] : null, adopted: adopted ? adopted[1] : null });
  }
  return { policies };
}

// files.neola.com. No index, so probe the three codes.
async function readFiles(slug) {
  const policies = [];
  for (const code of CODES) {
    const url = `https://files.neola.com/${slug}/search/policies/po${code}.htm`;
    const pg = await get(url); if (pg.status !== 200 || !pg.text) continue;
    const tt = /<title>([^<]*)<\/title>/i.exec(pg.text);
    const title = (tt ? text(tt[1]) : "").replace(/^\d+(\.\d+)?\s*[-–:]?\s*/, "").replace(/\s*-\s*Neola$/i, "").trim() || null;
    const t = text(pg.text);
    const revised = /(?:Last\s+)?Revised\s+(\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]+ \d{1,2}, \d{4})/.exec(t), adopted = /Adopted\s+(\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]+ \d{1,2}, \d{4})/.exec(t);
    policies.push({ code, title, url, candidates: clip(t).slice(0, 40), last_revised: revised ? revised[1] : null, adopted: adopted ? adopted[1] : null });
  }
  if (!policies.length) return { error: "no policy 5630/5630.01/5600 on files.neola.com", url: `https://files.neola.com/${slug}/search/policies/po5630.htm` };
  return { policies };
}

// ---- discovery
// 1. The district's own site. Home page first, then up to eight pages it links whose text or address
//    mentions the board or policies.
async function findOnSite(d) {
  if (!d.website) return null;
  const home = await get(d.website.startsWith("http") ? d.website : `http://${d.website}`);
  if (home.status !== 200 || !home.text) return null;
  const ls = links(home.text, home.url);
  const v = ls.map((l) => vendorOf(l.h)).find(Boolean); if (v) return { ...v, found_by: "district site" };
  const seen = new Set(); const cands = ls.filter((l) => /polic|board|trustee/i.test(l.t + " " + l.h) && !/\.(pdf|png|jpg|docx?)$/i.test(l.h) && !/facebook|twitter|instagram|youtube|boarddocs|neola/i.test(l.h) && !seen.has(l.h) && seen.add(l.h)).slice(0, 8);
  for (const c of cands) {
    const p = await get(c.h); if (p.status !== 200 || !p.text) continue;
    const v2 = links(p.text, p.url).map((l) => vendorOf(l.h)).find(Boolean); if (v2) return { ...v2, found_by: `district site ${c.h}` };
  }
  return null;
}
// 2. Slug guesses, each checked against the district's name on the manual itself.
function guesses(name) {
  const base = name.replace(/\(.*?\)/g, " ").replace(/[^A-Za-z0-9 ]/g, " ").trim();
  const words = base.split(/\s+/).filter(Boolean); const lw = words.map((w) => w.toLowerCase());
  const core = lw.filter((w) => !["school", "schools", "schl", "schls", "sch", "corp", "corporation", "community", "comm", "com", "consolidated", "con", "cons", "district", "dist", "public", "city", "inc", "the", "of", "msd", "metropolitan", "united", "area", "county", "co"].includes(w));
  const acr = lw.map((w) => w[0]).join(""), acrNoMsd = lw.filter((w) => w !== "msd").map((w) => w[0]).join("");
  const bd = new Set([acr, acrNoMsd, core.join(""), core[0], acr.replace(/sc$/, "csc"), core.join("") + "sc", core.join("") + "cs", core.join("") + "csc"]);
  const ne = new Set([core.join(""), core[0], acr, acrNoMsd, core.join("").slice(0, 4), core[0]?.slice(0, 4), core.map((w) => w[0]).join("") + "cs", core.map((w) => w[0]).join("") + "csc"]);
  return { boarddocs: [...bd].filter((s) => s && s.length >= 2), neola: [...ne].filter((s) => s && s.length >= 2).map((s) => `${s}-in`) };
}
async function findByGuess(d) {
  const g = guesses(d.name);
  for (const s of g.neola) { for (const host of ["neola", "files"]) { const v = { host, slug: s }; if (await verify(v, d.name)) return { ...v, found_by: "slug guess" }; } }
  for (const s of g.boarddocs) { const v = { host: "boarddocs", slug: s }; if (await verify(v, d.name)) return { ...v, found_by: "slug guess" }; }
  return null;
}
// 3. One Brave search, paced to one a second across all workers.
const braveKey = (() => { if (process.env.BRAVE_API_KEY) return process.env.BRAVE_API_KEY; const f = join(homedir(), ".brave.env"); if (!existsSync(f)) return null; const m = readFileSync(f, "utf8").match(/BRAVE_API_KEY=["']?([^"'\n]+)/); return m ? m[1].trim() : null; })();
let braveLast = 0, braveChain = Promise.resolve(), braveCalls = 0;
function brave(q) {
  return (braveChain = braveChain.then(async () => {
    const wait = braveLast + 1100 - Date.now(); if (wait > 0) await new Promise((z) => setTimeout(z, wait));
    braveLast = Date.now(); braveCalls++;
    try {
      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`, { headers: { "x-subscription-token": braveKey, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) return [];
      return ((await r.json()).web?.results ?? []).map((x) => ({ url: x.url, title: x.title || "" }));
    } catch { return []; }
  }));
}
async function findBySearch(d) {
  if (!braveKey) return null;
  const short = d.name.replace(/\b(Community|Comm|Con|Cons|Consolidated|School|Schools|Schl|Schls|Sch|Corp|Corporation|District|Dist|Inc|MSD)\b\.?/g, " ").replace(/\s+/g, " ").trim();
  const qs = [`"${d.name}" Indiana (site:go.boarddocs.com OR site:go.neola.com OR site:neola.com)`];
  if (short && short !== d.name) qs.push(`"${short}" Indiana schools (site:go.boarddocs.com OR site:go.neola.com OR site:neola.com)`);
  const tried = new Set();
  for (const q of qs) {
    for (const r of await brave(q)) {
      const v = vendorOf(r.url); if (!v) continue; const k = v.host + ":" + v.slug; if (tried.has(k)) continue; tried.add(k);
      const ok = await verifyAny(v, d.name); if (ok) return { ...ok, found_by: "search" };
    }
  }
  return null;
}

async function discover(d) {
  const cached = slugs[d.nces_id]; if (cached && cached.host) return cached;
  // A district's own link is the best evidence, but some point at a slug that no longer answers (White
  // River Valley links go.boarddocs.com/in/wrvsc, which is gone), so it is checked like the others.
  let v = await findOnSite(d); if (v) { const ok = await verifyAny(v, d.name, true); v = ok ? { ...ok, found_by: v.found_by } : null; }
  return v || (await findByGuess(d)) || (await findBySearch(d));
}

let i = 0, found = 0, rule = 0, silent = 0, errors = 0, nosite = 0;
const by = { boarddocs: 0, neola: 0, files: 0 };
async function worker() {
  for (;;) {
    const d = todo[i++]; if (!d) return;
    let v; try { v = await discover(d); } catch (err) { v = null; }
    if (!v) { nosite++; appendFileSync(OUT, JSON.stringify({ nces_id: d.nces_id, name: d.name, error: "no Neola manual found: not linked from the district site, no slug guess names the district, no search hit", url: d.website || null }) + "\n"); continue; }
    const r = await (v.host === "boarddocs" ? readBoardDocs(v.slug) : v.host === "neola" ? readNeola(v.slug) : readFiles(v.slug));
    // Remember the slug once the manual has actually answered, so a re-run skips discovery.
    if (!r.error || r.error.startsWith("no policy")) { slugs[d.nces_id] = v; saveSlugs(); }
    if (r.error) { errors++; appendFileSync(OUT, JSON.stringify({ nces_id: d.nces_id, name: d.name, host: v.host, slug: v.slug, error: r.error, url: r.url }) + "\n"); continue; }
    found++; by[v.host]++;
    const verdict = r.policies.some((p) => p.candidates.length) ? "rule" : "silent"; if (verdict === "rule") rule++; else silent++;
    appendFileSync(OUT, JSON.stringify({ site: null, nces_id: d.nces_id, district: d.name, _state: "IN", slug: `${v.host}:${v.slug}`, verdict, policies: r.policies }) + "\n");
    if (found % 20 === 0) console.log(`  ${found} manuals read (${rule} rule, ${silent} silent), ${errors} unreadable, ${nosite} not found, ${braveCalls} searches`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
console.log(`done: ${found} manuals read (${rule} with a corporal punishment rule, ${silent} silent; boarddocs ${by.boarddocs}, go.neola ${by.neola}, files.neola ${by.files}), ${errors} manuals without 5630, ${nosite} districts with no manual found, ${braveCalls} Brave searches -> ${OUT}`);
await reportOps({ pass: `neola-in-${new Date().toISOString().slice(0, 10)}`, summary: `Mothership read Indiana board policy 5630 in Neola manuals (BoardDocs, go.neola.com, files.neola.com): ${found} districts' policies read, ${nosite} manuals not found`, units: todo.length, produced: found, scope: "IN" });
