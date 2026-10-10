// Kansas board manuals are KASB manuals, and the corporal punishment rule is policy JDA. KASB does not
// publish them in one place: a district's manual is on KASB's own portal (policy.kasb.org, an Angular
// app over a JSON API, slug <Name>usd<N>), on BoardDocs (go.boarddocs.com/ks/usd<N>), or as a PDF on
// the district's own site (most of those sites sit behind a JavaScript challenge wall, but the PDFs
// they link on S3 do not). This reads JDA for every Kansas district the record does not yet quote,
// trying those three in that order and a web search last, then runs what it finds through the same
// clip-and-classify path as everything else.
//
//   node tools/ks/kasb-harvest.mjs [--workers 4] [--retry-errors] [--retry-silent] [--only <nces_id>] [--limit N]
//     -> data/handbooks/kasb-ks.jsonl (+ data/handbooks/kasb-ks-usd.json, the USD number map)
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { hasAnchor, NOT_THIS } from "../tasb/vocabulary.mjs";
import { reportOps } from "../lib/ops.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);
const WORKERS = Math.min(4, Number(arg("workers", 4)));
const OUT = process.env.KASB_OUT || join(root, "data/handbooks/kasb-ks.jsonl");
const USD_MAP = join(root, "data/handbooks/kasb-ks-usd.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TMP = join(tmpdir(), "kasb-harvest"); mkdirSync(TMP, { recursive: true });

// ---------- who to read ----------
const csvRows = (t) => { const [h, ...rows] = t.trim().split("\n"); const head = h.split(",").map((x) => x.trim().toLowerCase()); const parse = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o; }; return rows.map((l) => Object.fromEntries(head.map((k, i) => [k, (parse(l)[i] ?? "").trim()]))); };
const leas = csvRows(readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8")).filter((r) => r.state === "KS" && r.lea_type.startsWith("Regular public"));
const ks = parseYaml(readFileSync(join(root, "data/districts/KS.yaml"), "utf8"));
const quoted = new Set((Array.isArray(ks) ? ks : ks.districts).filter((r) => r.quote && r.source && ["allows", "bans", "consent_required"].includes(r.status)).map((r) => String(r.nces_id)));
let prior = existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
if (flag("retry-errors") || flag("retry-silent")) { prior = prior.filter((r) => !(flag("retry-errors") && r.error) && !(flag("retry-silent") && r.verdict === "silent")); writeFileSync(OUT, prior.map((r) => JSON.stringify(r)).join("\n") + (prior.length ? "\n" : "")); }
const done = new Set(prior.map((l) => l.nces_id));
let todo = leas.filter((r) => !quoted.has(r.nces_id) && !done.has(r.nces_id));
if (arg("only")) todo = leas.filter((r) => r.nces_id === arg("only"));
if (arg("limit")) todo = todo.slice(0, Number(arg("limit")));
console.log(`Kansas: ${leas.length} regular districts, ${quoted.size} already quoted, ${done.size} already tried, ${todo.length} to read`);

// ---------- USD numbers ----------
// The federal directory names districts ("Southeast Of Saline"); every Kansas host names them by
// number (usd306). Most websites carry the number; Wikipedia's list covers the rest; five are by hand.
const FIX = { "North Jackson": "335", "Greeley County Schools": "200", "Hoxie Community Schools": "412", "Leoti": "467", "Trego County": "208" };
const normName = (s) => s.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").replace(/\b(public schools?|school district|comm(unity)? sch(ools)?|schools)\b/g, "").replace(/\bsaint\b/g, "st").replace(/\bmount\b/g, "mt").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
async function usdMap() {
  if (existsSync(USD_MAP)) return JSON.parse(readFileSync(USD_MAP, "utf8"));
  const wiki = {};
  const r = await get("https://en.wikipedia.org/wiki/List_of_unified_school_districts_in_Kansas");
  for (const m of (r?.text ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const t = m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
    const mm = t.match(/^(.*?)\s*USD\s*(\d+)/); if (mm) wiki[normName(mm[1])] = { usd: mm[2], wiki: mm[1].trim() };
  }
  const map = {};
  for (const d of leas) {
    const fromSite = d.website.toLowerCase().match(/usd[-_]?(\d{3})\b/)?.[1]?.replace(/^0+/, "");
    const n = normName(d.name);
    let w = wiki[n]; if (!w) { const c = Object.entries(wiki).filter(([k]) => k && (n.startsWith(k) || k.startsWith(n))); if (c.length === 1) w = c[0][1]; }
    map[d.nces_id] = { name: d.name, usd: fromSite || w?.usd || FIX[d.name] || null, wiki: w?.wiki || null, from: fromSite ? "website" : w ? "wikipedia" : FIX[d.name] ? "hand" : null };
  }
  writeFileSync(USD_MAP, JSON.stringify(map, null, 1));
  return map;
}

// ---------- fetching ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Apptegy district sites answer a browser User-Agent with a JavaScript challenge page and answer a
// plainly named tool with the page itself, so the second try says what it is.
const BOT_UA = "EarthPilot-ESCP/1.0 (+https://earthpilot.org; school policy reader)";
async function get(url, { method = "GET", body, headers = {}, binary = false, timeout = 30_000, ua = UA } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { method, body, headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,application/pdf,application/json;q=0.9,*/*;q=0.8", ...headers }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
      if (r.status >= 500 || r.status === 429) { await sleep(1500 * 2 ** attempt); continue; }
      const ctype = r.headers.get("content-type") || "";
      if (binary || /pdf|octet-stream/i.test(ctype) || /\.pdf(\?|$)/i.test(r.url)) { const buf = Buffer.from(await r.arrayBuffer()); return { status: r.status, url: r.url, ctype, buf, text: null }; }
      const text = await r.text();
      if (ua === UA && /<title>Client Challenge<\/title>/.test(text)) return get(url, { method, body, headers, binary, timeout, ua: BOT_UA });
      return { status: r.status, url: r.url, ctype, text, buf: null };
    } catch { await sleep(1000 * 2 ** attempt); }
  }
  return null;
}
const walled = (r) => !r || r.status !== 200 || /Client Challenge/.test(r.text || "");
const html2text = (html) => html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#xa0;| /g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&quot;|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"').replace(/&ndash;|&#8211;/g, "-").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
let pdfN = 0;
function pdfText(buf) {
  if (!buf || buf.subarray(0, 5).toString() !== "%PDF-") return "";
  const f = join(TMP, `d${process.pid}-${pdfN++}.pdf`); writeFileSync(f, buf);
  try { return execFileSync("pdftotext", [f, "-"], { maxBuffer: 128e6, timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch { return ""; } finally { try { unlinkSync(f); } catch {} }
}
const docText = (r) => (r?.buf ? pdfText(r.buf) : r?.text ? html2text(r.text) : "");
const links = (html, base) => { const out = []; for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) { try { out.push({ url: new URL(m[1].replace(/&amp;/g, "&"), base).href, text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }); } catch {} } return out; };

// ---------- the rule ----------
// Sentences. HTML text breaks at block boundaries, so a line break ends a sentence there; PDF text
// breaks wherever the page did, so there it is joined back up. Either way a policy heading that runs
// into its first sentence ("JDA Corporal Punishment Corporal punishment shall not...") is cut off so
// the quote is the sentence a reader can find on the page.
const HEADING = /^(?:JDA\b[\s\-–—:]*)?(?:Corporal\s+Punishment\b[\s\-–—:]*)?(?=[A-Z])/;
const clip = (t, mode = "pdf") => [...new Set((mode === "html" ? t.split(/(?<=[.;:])\s+|\n+/) : t.replace(/\s*\n\s*/g, " ").split(/(?<=[.;:])\s+/)).map((s) => s.replace(/\s+/g, " ").trim().replace(HEADING, "").trim()).filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s) && !NOT_THIS.some((n) => s.toLowerCase().includes(n))))];
// The JDA section of a whole manual: the heading that is followed by text rather than by the dot
// leaders of a table of contents, through to the next policy code. Without a JDA heading, the
// neighbourhood of every anchor word instead.
function jdaWindow(t) {
  // A real heading has a rule sentence under it ("corporal punishment", lower case); a table of
  // contents has only the next Title Case entry.
  const heads = [...t.matchAll(/\bJDA\b[\s\-–—:]*Corporal\s+Punishment/gi)].filter((m) => !/\.{4,}|…/.test(t.slice(m.index, m.index + 300)) && (/punishment/.test(m[0]) || /corporal punish|paddl|spank|\bswat|\blicks\b/i.test(t.slice(m.index + m[0].length, m.index + 900))));
  if (heads.length) {
    const h = heads[heads.length - 1];
    const rest = t.slice(h.index, h.index + 6000);
    const end = rest.slice(20).search(/\n\s*JD[B-Z]\b|\bJDB\s*[\-–—:]?\s*Detention|\n\s*JDD\b/);
    return { code: "JDA", text: end > 0 ? rest.slice(0, end + 20) : rest };
  }
  const wins = []; for (const m of t.matchAll(/corporal punish|paddl|spank|\bswat|\blicks\b/gi)) { if (wins.length >= 12) break; wins.push(t.slice(Math.max(0, m.index - 1200), m.index + 1200)); }
  return { code: null, text: wins.join("\n") };
}
const revised = (t) => t.match(/(?:Approved|Adopted|Revised|Reviewed)\s*:?\s*((?:\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]+ \d{1,2}, \d{4})(?:\s*[;,]\s*(?:\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]+ \d{1,2}, \d{4}))*)/)?.[1]?.trim() ?? null;
const kasbMarker = (t) => /reproduced for use in USD|KASB Recommendation|©\s*KASB/i.test(t);

// ---------- 1. KASB portal ----------
const PORTAL = "https://policy.kasb.org";
const sopGet = async (p) => { const r = await get(`${PORTAL}/sopapi/${p}`, { headers: { accept: "application/json" } }); try { const j = JSON.parse(r?.text ?? "null"); return typeof j === "string" ? JSON.parse(j) : j; } catch { return null; } };
function portalSlugs(d, usd, extra = []) {
  const v = new Set(extra);
  if (!usd) return [...v];
  const names = new Set([d.name, usd.wiki].filter(Boolean).map((s) => s.replace(/\s*\(.*?\)\s*/g, " ").replace(/\./g, "").trim()));
  for (const n of [...names]) { names.add(n.replace(/\bCo\b/g, "County")); names.add(n.replace(/\bCounty\b/g, "Co")); names.add(n.replace(/\bComm Sch\b|\bCommunity Schools?\b|\bPublic Schools?\b|\bSchools?\b|\bSch\b|\bPub Sch\b/g, "").trim()); names.add(n.replace(/\bPub Sch\b/g, "Public Schools")); }
  for (const n of names) { const s = n.replace(/[^A-Za-z0-9]/g, ""); if (s) { v.add(`${s}usd${usd.usd}`); v.add(`${s}usd${usd.usd}policy`); v.add(`${s}USD${usd.usd}`); } }
  v.add(`usd${usd.usd}`); v.add(`USD${usd.usd}`);
  return [...v];
}
async function readPortal(d, slugs) {
  for (const slug of slugs) {
    const set = await sopGet(`toc/getshowset/kansas/${encodeURIComponent(slug)}`);
    const col = Array.isArray(set) ? set.find((x) => x.code) : null; if (!col) continue;
    // Walk the manual: sections at the top, policies under "Section J - Students" (or anywhere, to depth 3).
    const want = (n) => /^JDA\b/i.test(n.title) || /corporal punishment/i.test(n.title);
    const fallback = (n) => /^(JDD|JD|JCDA)\b/i.test(n.title);
    const found = [], fb = [];
    async function walk(node, depth) {
      const kids = await sopGet(`toc/getchildren/kansas/${encodeURIComponent(slug)}/${node.collectionCode}/${node.code}/${node.id}`);
      if (!Array.isArray(kids)) return;
      for (const k of kids) {
        if (want(k)) found.push(k); else if (fallback(k)) fb.push(k);
        if (k.hasChildren && depth < 3 && (depth === 0 || /section j|students|^J\b/i.test(k.title) || found.length === 0)) await walk(k, depth + 1);
      }
    }
    await walk({ collectionCode: col.collectionCode || col.code, code: col.code, id: col.id }, 0);
    const nodes = found.length ? found : fb.slice(0, 2);
    if (!nodes.length) return { slug, error: "manual on the KASB portal has no JDA, JDD or JD", url: `${PORTAL}/Kansas/browse/${slug}` };
    const policies = [];
    for (const n of nodes) {
      const doc = await sopGet(`document/getdocument/kansas/${encodeURIComponent(slug)}/${n.collectionCode}/${n.code}`);
      if (!doc?.html) continue;
      const t = html2text(doc.html);
      const m = n.title.match(/^([A-Z]{2,6})\b\s*[-–—:]?\s*(.*)$/);
      policies.push({ code: m?.[1] ?? n.title, title: m?.[2]?.trim() || n.title, url: `${PORTAL}/Kansas/browse/${slug}/${n.collectionCode}/${n.code}`, candidates: clip(t, "html").slice(0, 40), last_revised: revised(t) ?? (doc.dtAdopted ? doc.dtAdopted.slice(0, 10) : null) });
    }
    if (policies.length) return { slug, policies };
  }
  return null;
}

// ---------- 2. BoardDocs ----------
async function readBoardDocs(slug) {
  const base = `https://go.boarddocs.com/ks/${slug}/Board.nsf`;
  const books = await get(`${base}/BD-GetPolicyBooks?open`, { method: "POST", body: "", headers: { "content-type": "application/x-www-form-urlencoded" } });
  if (!books || books.status !== 200 || !/dropdown-item/.test(books.text || "")) return null;
  const names = [...books.text.matchAll(/class="dropdown-item"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
  const policies = [];
  for (const book of names) {
    const list = await get(`${base}/BD-GetPolicies?open`, { method: "POST", body: new URLSearchParams({ status: "active", book }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
    if (!list?.text) continue;
    const items = [...list.text.matchAll(/unique=\s*"([A-Z0-9]+)"[\s\S]*?<b>([^<]*)<\/b><\/div><div>([^<]*)/g)].map((m) => ({ id: m[1], code: m[2].trim(), title: m[3].trim() }));
    let pick = items.filter((p) => /^JDA\b/i.test(p.code) || /corporal punishment/i.test(p.title));
    if (!pick.length) pick = items.filter((p) => /^(JDD|JD)$/i.test(p.code)).slice(0, 2);
    for (const p of pick) {
      const item = await get(`${base}/BD-GetPolicyItem?open`, { method: "POST", body: new URLSearchParams({ id: p.id }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
      if (!item?.text) continue;
      const body = item.text.match(/key="publicbody"[^>]*>([\s\S]*?)<div filetype=/)?.[1] ?? item.text;
      const t = html2text(body);
      const dates = [...item.text.matchAll(/leftcol">(Adopted|Last Revised|Last Reviewed)<\/div><div class="col rightcol">([^<]+)</g)].map((m) => `${m[1]}: ${m[2].trim()}`).join("; ");
      policies.push({ code: p.code, title: p.title, url: `${base}/goto?open&id=${p.id}`, candidates: clip(t, "html").slice(0, 40), last_revised: revised(t) ?? (dates || null) });
    }
    if (policies.length) break;
  }
  return policies.length ? { slug: `boarddocs:${slug}`, policies } : { slug: `boarddocs:${slug}`, error: "BoardDocs manual has no JDA, JDD or JD", url: `${base}/Public` };
}

// ---------- 3. the district's own site ----------
// Most Kansas district sites are Apptegy sites: the page is a JavaScript app, the sitemap lists every
// document folder, and a folder page carries its files as JSON rather than links. The rest are
// ordinary pages, Google Sites, or a Google Drive folder of one PDF per policy. All of them end in a
// PDF, a Google Doc, or a page with the policy text on it.
const DOC_HOSTS = /core-docs\.s3|thrillshare\.com|finalsite\.net|sharpschool\.com|s3\.amazonaws\.com|scschoolfiles|cdn-website\.com|5il\.co|aptg\.co|cloudfront\.net|squarespace\.com|wixstatic\.com|weebly\.com\/uploads/i;
const POLICY_LINK = /board.?polic|\bpolic(y|ies)\b|policy.?(book|manual|index|handbook)|board.?of.?education|\bboe\b|\bboard\b/i;
const NOT_POLICY = /wellness|privacy|meal|nutrition|bully|cell.?phone|attendance|enrollment|\besi\b|emergency|title.?ix|technology|acceptable.?use|drug|tobacco|facebook|twitter|instagram|youtube|mailto:|tel:|minutes|agenda|election|calendar|lunch|menu|\.(png|jpe?g|gif|svg|css|js|mp4)(\?|$)/i;
const JDA_LIKE = /\bjda\b|corporal/i;
const SECTION_J = /sect(ion)?[\s_\-]*j\b|[\s_\-]j[\s_\-.]|\bj\s*[-–—]|students|chapter[\s_]*j/i;
const MANUAL_LIKE = /polic|manual|handbook|book|section|sect_|chapter/i;
const isDoc = (u) => /\.pdf(\?|$)/i.test(u) || (DOC_HOSTS.test(u) && !/\.(png|jpe?g|gif|svg|css|js)(\?|$)/i.test(u));
const rkey = (u) => u.match(/[?&]resourcekey=([A-Za-z0-9_-]+)/)?.[1];
const gdrive = (u) => { const f = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?.*id=)([A-Za-z0-9_-]{20,})/); if (f) return { kind: "file", id: f[1] }; const fo = u.match(/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|folderview\?id=|embeddedfolderview\?id=)([A-Za-z0-9_-]{20,})/); if (fo) return { kind: "folder", id: fo[1], key: rkey(u) }; const doc = u.match(/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{20,})/); if (doc) return { kind: "doc", id: doc[1] }; return null; };
function identity(t, d, usd) {
  if (usd && new RegExp(`U\\.?S\\.?D\\.?\\s*#?\\s*0*${usd.usd}\\b`, "i").test(t)) return true;
  const n = d.name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\b(public schools?|school district|comm sch|community schools?|schools?|co|county)\b/gi, "").trim();
  return n.length >= 4 && new RegExp(n.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).join("\\s+"), "i").test(t);
}
// Read one document. `shown` is the address a reader opens; `fetchUrl` is what the server will give us.
async function readDocument(shown, d, usd, { fetchUrl = shown, linked = false, text: pre = null } = {}) {
  let t = pre, finalUrl = shown;
  if (!t) {
    const r = await get(fetchUrl, { timeout: 60_000 }); if (!r || r.status !== 200) return null;
    if (r.buf && r.buf.length > 60e6) return null;
    t = docText(r); if (!/drive\.google|docs\.google/.test(fetchUrl)) finalUrl = r.url;
  }
  if (!t || t.length < 300) return null;
  // "Silent" is a claim about the manual's Section J, so it needs Section J in hand: JDA's neighbours
  // (detention, probation, suspension, conduct) on the page. A Section A file or a student handbook
  // that cites one code is not the manual's student section.
  const manual = ["JDB", "JDC", "JDD", "JCDA", "JCEC", "JDDC"].filter((c) => new RegExp(`\\b${c}\\b`).test(t)).length >= 2;
  const body = t.replace(/\bJDA\b[\s\-–—:]*Corporal\s+Punishment/gi, "");
  if (/\bJDA\b[\s\-–—:]*Corporal\s+Punishment/i.test(t) && !hasAnchor(body)) return { unreadable: true, url: finalUrl, manual };
  if (!hasAnchor(t)) return manual ? { silent: true, url: finalUrl, manual } : null;
  if (!linked && !identity(t, d, usd)) return null;
  const w = jdaWindow(t);
  const c = clip(w.text, /\.pdf(\?|$)|drive\.google/i.test(fetchUrl) ? "pdf" : "html");
  if (!c.length) return manual ? { silent: true, url: finalUrl, manual } : null;
  return { url: finalUrl, manual, policy: { code: w.code ?? "manual", title: w.code ? "Corporal Punishment" : "Board policy document (no JDA heading; passages that name corporal punishment)", url: finalUrl, candidates: c.slice(0, 40), last_revised: revised(w.text) } };
}
async function readSite(d, usd, home) {
  const out = { hints: { portal: [], boarddocs: [] }, silent: null, found: null, unreadable: null, walled: false };
  if (!home || home.status !== 200 || !home.text) return out;
  if (/<title>Client Challenge<\/title>/.test(home.text)) { out.walled = true; return out; }
  const host = new URL(home.url).host.replace(/^www\./, "");
  const same = (u) => { try { return new URL(u).host.replace(/^www\./, "") === host; } catch { return false; } };
  const hint = (html) => { for (const m of html.matchAll(/policy\.kasb\.org\/kansas\/browse\/([A-Za-z0-9]+)/gi)) out.hints.portal.push(m[1]); for (const m of html.matchAll(/boarddocs\.com\/ks\/([a-z0-9]+)\//gi)) out.hints.boarddocs.push(m[1]); };
  hint(home.text);
  // Everything a page points at: links, plus any document address sitting in its scripts or JSON.
  const refs = (html, base) => { const ls = links(html, base); const seen = new Set(ls.map((l) => l.url)); for (const m of html.matchAll(/https?:\\?\/\\?\/[^\s"'<>\\]+?\.pdf(?:\?[^\s"'<>\\]*)?|https?:\\?\/\\?\/(?:files-backend\.assets\.thrillshare\.com|core-docs\.s3[^\s"'<>\\/]*\.amazonaws\.com|drive\.google\.com|docs\.google\.com)[^\s"'<>\\]*/gi)) { const u = m[0].replace(/\\\//g, "/").replace(/&amp;/g, "&"); if (!seen.has(u)) { seen.add(u); ls.push({ url: u, text: decodeURIComponent(u.split("/").pop() || "").replace(/[_\-+]/g, " ") }); } } return ls; };
  const score = (l) => { const s = l.text + " " + decodeURIComponent(l.url); return JDA_LIKE.test(s) ? 0 : gdrive(l.url)?.kind === "folder" ? 1 : gdrive(l.url) ? (MANUAL_LIKE.test(s) ? 2 : 4) : SECTION_J.test(s) ? 1 : /board.?polic|policy.?(manual|book|handbook)|polic(y|ies)\b/i.test(s) ? 2 : MANUAL_LIKE.test(s) ? 3 : 9; };
  const queue = [];
  const unwanted = (l) => NOT_POLICY.test(l.text + " " + l.url) && !/board.?polic|policy.?(book|manual)|\bjda\b/i.test(l.text + " " + l.url);
  const push = (ls, depth, maxScore) => { for (const l of ls) { const sc = score(l); if (sc <= maxScore && !unwanted(l)) queue.push({ ...l, depth, sc }); } queue.sort((a, b) => a.sc - b.sc || a.depth - b.depth); };
  // Apptegy: the sitemap names the board policy folder outright.
  if (/thrillshare|apptegy/i.test(home.text)) {
    const sm = await get(`https://${new URL(home.url).host}/sitemap.xml`);
    const locs = [...(sm?.text ?? "").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&")).filter((u) => /\/documents\//.test(u) && /polic|manual|\bboard|\bboe\b/i.test(u) && !unwanted({ url: u, text: "" }));
    const ls = locs.map((u) => ({ url: u, text: decodeURIComponent(u.split("/").slice(-2, -1)[0] || "").replace(/-/g, " ") })).map((l) => ({ ...l, sc: score(l) })).sort((a, b) => a.sc - b.sc || a.url.length - b.url.length);
    push([...ls.filter((l) => l.sc <= 1), ...ls.filter((l) => l.sc === 2).slice(0, 3), ...ls.filter((l) => l.sc === 3).slice(0, 1)], 1, 3);
  }
  push(refs(home.text, home.url).filter((l) => POLICY_LINK.test(l.text + " " + l.url) && (same(l.url) || isDoc(l.url) || gdrive(l.url) || /sites\.google\.com/.test(l.url))), 1, 9);
  const seen = new Set([home.url]); let pages = 0, docs = 0;
  while (queue.length && pages < 16 && docs < 12) {
    const l = queue.shift(); if (seen.has(l.url)) continue; seen.add(l.url);
    if (process.env.DEBUG) console.log(`    [${l.depth}/${l.sc}] ${l.url} | ${l.text.slice(0, 50)}`);
    const g = gdrive(l.url);
    if (g?.kind === "folder") {
      pages++;
      const r = await get(`https://drive.google.com/embeddedfolderview?id=${g.id}${g.key ? `&resourcekey=${g.key}` : ""}`); if (!r?.text) continue;
      const entries = [...r.text.matchAll(/<a href="(https:\/\/drive\.google\.com\/[^"]+)"[\s\S]*?flip-entry-title">([^<]*)</g)].map((m) => ({ url: m[1].replace(/&amp;/g, "&"), text: m[2] }));
      const wanted = entries.filter((e) => JDA_LIKE.test(e.text) || (SECTION_J.test(e.text) && MANUAL_LIKE.test(e.text)) || /^j[a-z]*\b/i.test(e.text.trim()) && /JD/.test(e.text) || gdrive(e.url)?.kind === "folder" && /polic|section|j\b|students/i.test(e.text));
      push(wanted.length ? wanted : entries.filter((e) => MANUAL_LIKE.test(e.text)).slice(0, 6), l.depth + 1, 9);
      continue;
    }
    if (g?.kind === "file" || g?.kind === "doc" || isDoc(l.url)) {
      docs++;
      const fetchUrl = g?.kind === "file" ? `https://drive.google.com/uc?export=download&confirm=t&id=${g.id}` : g?.kind === "doc" ? `https://docs.google.com/document/d/${g.id}/export?format=txt` : l.url;
      const shown = g?.kind === "file" ? `https://drive.google.com/file/d/${g.id}/view` : g?.kind === "doc" ? `https://docs.google.com/document/d/${g.id}/edit` : l.url;
      const got = await readDocument(shown, d, usd, { fetchUrl, linked: true });
      if (got?.policy) { out.found = got; return out; }
      if (got?.silent && got.manual && !out.silent) out.silent = got;
      if (got?.unreadable && !out.unreadable) out.unreadable = got;
      continue;
    }
    if (!(same(l.url) || /sites\.google\.com/.test(l.url))) continue;
    pages++;
    const r = await get(l.url); if (!r || r.status !== 200) continue;
    if (r.buf) { docs++; const got = await readDocument(r.url, d, usd, { linked: true, text: docText(r) }); if (got?.policy) { out.found = got; return out; } if (got?.silent && got.manual && !out.silent) out.silent = got; if (got?.unreadable && !out.unreadable) out.unreadable = got; continue; }
    if (!r.text || /<title>Client Challenge<\/title>/.test(r.text)) continue;
    hint(r.text);
    const t = html2text(r.text);
    if (hasAnchor(t) && /\bJDA\b/.test(t)) { const got = await readDocument(r.url, d, usd, { linked: true, text: t }); if (got?.policy) { out.found = got; return out; } }
    const sub = refs(r.text, r.url).filter((x) => !seen.has(x.url));
    push(sub.filter((x) => isDoc(x.url) || gdrive(x.url)), l.depth + 1, l.depth >= 2 ? 3 : 9);
    if (l.depth < 3) push(sub.filter((x) => (same(x.url) || /sites\.google\.com/.test(x.url)) && !isDoc(x.url) && !gdrive(x.url)), l.depth + 1, l.depth === 1 ? 3 : 2);
  }
  return out;
}

// ---------- 4. web search, last ----------
const braveKey = (() => { const f = join(homedir(), ".brave.env"); return process.env.BRAVE_API_KEY || (existsSync(f) ? readFileSync(f, "utf8").match(/BRAVE_API_KEY=["']?([^"'\n]+)/)?.[1] : null); })();
let braveNext = 0, braveDead = false, searches = 0;
async function brave(q) {
  if (!braveKey || braveDead) return [];
  const wait = braveNext - Date.now(); braveNext = Math.max(Date.now(), braveNext) + 1100; if (wait > 0) await sleep(wait);
  try {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?count=10&q=${encodeURIComponent(q)}`, { headers: { "X-Subscription-Token": braveKey, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 429 || r.status === 402) { braveDead = true; console.log(`  search stopped: HTTP ${r.status}`); return []; }
    searches++;
    return ((await r.json()).web?.results ?? []).map((x) => x.url);
  } catch { return []; }
}
async function readSearch(d, usd) {
  if (!usd) return null;
  const skip = /facebook|twitter|youtube|linkedin|wikipedia|niche\.com|greatschools|ksde\.gov|nasbe|findlaw|justia|news|\.gov\//i;
  for (const q of [`"USD ${usd.usd}" Kansas "corporal punishment" JDA`, `"USD ${usd.usd}" Kansas board policy "corporal punishment"`]) {
    const urls = (await brave(q)).filter((u) => !skip.test(u)).slice(0, 5);
    for (const u of urls) { const got = await readDocument(u, d, usd); if (got?.policy) return got; }
  }
  return null;
}

// ---------- run ----------
const usd = await usdMap();
const slugCache = {};
let i = 0, nRule = 0, nSilent = 0, nErr = 0; const hosts = {};
const emit = (o) => appendFileSync(OUT, JSON.stringify(o) + "\n");
const record = (d, slug, policies, host) => { const verdict = policies.some((p) => p.candidates.length) ? "rule" : "silent"; verdict === "rule" ? nRule++ : nSilent++; hosts[host] = (hosts[host] || 0) + 1; emit({ site: null, nces_id: d.nces_id, district: d.name, _state: "KS", slug, verdict, policies }); };
async function worker() {
  for (;;) {
    const d = todo[i++]; if (!d) return;
    const u = usd[d.nces_id]?.usd ? usd[d.nces_id] : null;
    try {
      const home = d.website ? await get(d.website) : null;
      const site = await readSite(d, u, home);         // cheap, and it may name the portal or BoardDocs slug
      // 1. KASB portal, with any slug the district's own site named first.
      const portal = await readPortal(d, portalSlugs(d, u, site.hints?.portal ?? []));
      if (portal?.policies) { record(d, `kasb:${portal.slug}`, portal.policies, "policy.kasb.org"); continue; }
      // 2. BoardDocs.
      let bd = null;
      for (const s of [...new Set([...(site.hints?.boarddocs ?? []), u ? `usd${u.usd}` : null].filter(Boolean))]) { bd = await readBoardDocs(s); if (bd?.policies) break; }
      if (bd?.policies) { record(d, bd.slug, bd.policies, "boarddocs"); continue; }
      // 3. a document on the district's own site.
      if (site.found) { record(d, `site:${new URL(site.found.url).host}`, [site.found.policy], "district site"); continue; }
      // 4. search.
      const s = await readSearch(d, u);
      if (s?.policy) { record(d, `search:${new URL(s.url).host}`, [s.policy], "search"); continue; }
      if (site.unreadable) { nErr++; emit({ nces_id: d.nces_id, name: d.name, slug: `site:${new URL(site.unreadable.url).host}`, error: "manual found and JDA is in its table of contents, but the JDA page has no text layer (scanned image); needs OCR or a person", url: site.unreadable.url }); continue; }
      if (site.silent) { record(d, `site:${new URL(site.silent.url).host}`, [{ code: "manual", title: "Board policy manual (no corporal punishment language)", url: site.silent.url, candidates: [], last_revised: null }], "district site"); continue; }
      if (portal?.error) { nErr++; emit({ nces_id: d.nces_id, name: d.name, slug: `kasb:${portal.slug}`, error: portal.error, url: portal.url }); continue; }
      nErr++;
      emit({ nces_id: d.nces_id, name: d.name, slug: null, usd: u?.usd ?? null, error: site.walled ? "district site answered both User-Agents with a JavaScript challenge; no KASB portal manual, BoardDocs manual or search hit" : home?.status === 200 ? "no board policy manual found on the KASB portal, BoardDocs, the district site or by search" : `district site unreachable (${home?.status ?? "no response"}); no KASB portal, BoardDocs or search hit`, url: d.website || undefined });
    } catch (e) { nErr++; emit({ nces_id: d.nces_id, name: d.name, slug: null, error: `harvester threw: ${e.message}`, url: d.website || undefined }); }
    finally { const n = nRule + nSilent + nErr; if (n % 20 === 0) console.log(`  ${n}: ${nRule} rule, ${nSilent} silent, ${nErr} error; ${searches} searches`); }
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
console.log(`done: ${nRule} with a rule, ${nSilent} silent, ${nErr} errors; hosts ${JSON.stringify(hosts)}; ${searches} web searches -> ${OUT}`);
await reportOps({ pass: `kasb-ks-${new Date().toISOString().slice(0, 10)}`, summary: `Mothership read Kansas board policy JDA (KASB portal, BoardDocs, district sites): ${nRule} districts with a rule, ${nSilent} silent, ${nErr} not found`, units: todo.length, produced: nRule + nSilent, scope: "KS" });
