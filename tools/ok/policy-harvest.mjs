// Oklahoma has no policy portal. OSSBA sells its member districts a manual (codes A..J, with FO
// "Student Discipline" and FOB "Corporal Punishment" carrying the rule) but hosts nothing public: the
// manuals sit on each district's own website as one PDF per policy, or one PDF for the whole book, in
// a document library on Apptegy (most of the state), ParentSquare SmartSites, or whatever the district
// bought. So this reads the district's own site: find its board-policy or documents area, take the
// documents whose names say discipline, read them, and clip the sentences about corporal punishment.
//
// Apptegy serves every page but the home page behind an F5 challenge, so those are read with the same
// headless browser the walled-site reader uses; the home page and every PDF answer a plain request.
//
//   node tools/ok/policy-harvest.mjs [--workers 4] [--only 4007290] [--limit 20]
//     -> data/handbooks/boardpolicy-ok.jsonl
//   node tools/ok/policy-harvest.mjs --retry-search     (needs BRAVE_API_KEY; one query a second)
//     re-tries every district the walk could not read, or read only a silent handbook, by asking the
//     search engine for its documents and walking again -> data/handbooks/boardpolicy-ok-retry.jsonl
//   node tools/ok/policy-harvest.mjs --merge            folds the retry rows into the main file
import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import { hasAnchor, NOT_THIS } from "../tasb/vocabulary.mjs";
import { fetchWithBrowser, closeBrowser } from "../tasb/browser.mjs";
import { reportOps } from "../lib/ops.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const WORKERS = Math.min(4, Number(arg("workers", 4)));
const ONLY = arg("only", null), LIMIT = Number(arg("limit", 0)), DEBUG = process.argv.includes("--debug");
const OUT = isAbsolute(arg("out", "")) ? arg("out", "") : join(root, arg("out", "data/handbooks/boardpolicy-ok.jsonl"));
const RETRY = process.argv.includes("--retry-search"), MERGE = process.argv.includes("--merge");
const OUT_RETRY = OUT.replace(/\.jsonl$/, "-retry.jsonl");
const BRAVE = process.env.BRAVE_API_KEY;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE_BUDGET = 16, DOC_BUDGET = 8, MAX_DOC_BYTES = 40e6;

const csvRows = (t) => { const [h, ...rows] = t.trim().split("\n"); const head = h.split(",").map((x) => x.trim().toLowerCase()); const parse = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o; }; return rows.map((l) => Object.fromEntries(head.map((k, i) => [k, (parse(l)[i] ?? "").trim()]))); };
const leas = csvRows(readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8")).filter((r) => r.state === "OK" && r.lea_type.startsWith("Regular public"));
const ok = parseYaml(readFileSync(join(root, "data/districts/OK.yaml"), "utf8"));
const quoted = new Set((Array.isArray(ok) ? ok : ok.districts).filter((r) => r.quote && r.source && ["allows", "bans", "consent_required"].includes(r.status)).map((r) => String(r.nces_id)));
mkdirSync(dirname(OUT), { recursive: true });
const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).nces_id) : []);
const prior = existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const errored = new Set(prior.filter((r) => r.error || r.verdict === "silent").map((r) => r.nces_id));
const retried = new Set(existsSync(OUT_RETRY) ? readFileSync(OUT_RETRY, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).nces_id) : []);
const better = (old, row) => row.verdict === "rule" || (old?.error && !row.error) ? row : (old?.error && row.error ? { ...old, error: `${old.error}; retry: ${row.error}` } : old);
if (MERGE) {
  const rows = new Map(prior.map((r) => [r.nces_id, r]));
  for (const row of existsSync(OUT_RETRY) ? readFileSync(OUT_RETRY, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []) if (rows.has(row.nces_id)) rows.set(row.nces_id, better(rows.get(row.nces_id), row));
  writeFileSync(OUT, [...rows.values()].map((r) => JSON.stringify(r)).join("\n") + "\n");
  const v = [...rows.values()]; console.log(`merged: ${v.filter((r) => r.verdict === "rule").length} rule, ${v.filter((r) => r.verdict === "silent").length} silent, ${v.filter((r) => r.error).length} errors -> ${OUT}`);
  process.exit(0);
}
let todo = leas.filter((r) => !quoted.has(r.nces_id) && (RETRY ? errored.has(r.nces_id) && !retried.has(r.nces_id) : !done.has(r.nces_id)) && (!ONLY || r.nces_id === ONLY));
if (LIMIT) todo = todo.slice(0, LIMIT);
console.log(`Oklahoma: ${leas.length} regular districts, ${quoted.size} already quoted, ${done.size} already tried, ${todo.length} to read`);

// --- fetching -------------------------------------------------------------------------------------
const CHALLENGE = /Client Challenge|Pardon Our Interruption|_Incapsula_|Just a moment|Enable JavaScript and cookies/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, { binary = false, timeout = 45_000 } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: binary ? "*/*" : "text/html,application/xhtml+xml,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
      if (r.status >= 500 || r.status === 429) { await sleep(2000 * 2 ** attempt); continue; }
      if (!r.ok) return null;
      const len = Number(r.headers.get("content-length") || 0); if (len > MAX_DOC_BYTES) return null;
      const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAX_DOC_BYTES) return null;
      return { url: r.url, type: (r.headers.get("content-type") || "").toLowerCase(), buf, text: binary ? null : buf.toString("utf8") };
    } catch (e) { if (attempt === 2) return null; await sleep(1500 * 2 ** attempt); }
  }
  return null;
}

const unescapeHtml = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&#x27;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
const htmlText = (html) => unescapeHtml(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d|td)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const abs = (href, base) => { try { return new URL(href, base).href; } catch { return null; } };
// Links from served HTML: anchors, plus the name/url pairs in the JSON state Apptegy inlines (its nav and
// document links are there even when the rendered anchors are not).
function linksFromHtml(html, base) {
  const out = [], seen = new Set();
  const add = (u, t) => { const a = abs(u, base); if (!a || /^(mailto|tel|javascript):/i.test(a) || seen.has(a)) return; seen.add(a); out.push({ url: a, text: (t || "").replace(/\s+/g, " ").trim().slice(0, 120) }); };
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,2500}?)<\/a>/gi)) add(unescapeHtml(m[1]), unescapeHtml(m[2].replace(/<[^>]+>/g, " ")));
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>\\)]+\.(?:pdf|docx?)(?:\?[^\s"'<>\\)]*)?/gi)) add(unescapeHtml(m[0]), "");
  const j = html.replace(/\\"/g, '"').replace(/\\\//g, "/");
  for (const m of j.matchAll(/"name":"([^"]{1,120})"[^{}]{0,400}?"url":"([^"]+)"/g)) add(m[2], m[1]);
  for (const m of j.matchAll(/"(?:file_url|download_url|asset_url|document_url)":"([^"]+)"/g)) add(m[1], "");
  return out;
}
// A Google Drive folder is a web page only to a browser, and its listing is not links but data-id
// entries labelled with the file's name and kind. Ardmore keeps its whole manual this way, one folder
// per OSSBA section. Folders become pages to walk, files become documents to read.
const DRIVE_FOLDER = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/;
async function driveFolder(url) {
  let b = null; try { b = await fetchWithBrowser(url, { settleMs: 6000 }); } catch { b = null; }
  if (!b) return null;
  const pos = [...b.html.matchAll(/data-id="([\w-]{20,})"/g)].map((m) => ({ at: m.index, id: m[1] }));
  const links = [], seen = new Set();
  pos.forEach((p, k) => {
    if (seen.has(p.id)) return;
    const seg = b.html.slice(p.at, k + 1 < pos.length ? pos[k + 1].at : p.at + 20000);
    const m = seg.match(/aria-label="([^"]{1,200}?) (PDF|Google Docs|Shared folder|Folder|Microsoft Word|Word)"/);
    if (!m) return; seen.add(p.id);
    const name = unescapeHtml(m[1]);
    if (/folder/i.test(m[2])) links.push({ url: `https://drive.google.com/drive/folders/${p.id}`, text: name });
    else if (/Google Docs/.test(m[2])) links.push({ url: `https://docs.google.com/document/d/${p.id}/edit`, text: name });
    else links.push({ url: `https://drive.google.com/file/d/${p.id}/view`, text: name });
  });
  return { url, html: b.html, links, via: "drive" };
}
// A web page, by plain fetch when the site allows it and by browser when it answers with a challenge.
async function page(url) {
  if (DRIVE_FOLDER.test(url)) return driveFolder(url);
  const r = await get(url);
  if (r && r.text && !CHALLENGE.test(r.text.slice(0, 4000)) && /html/.test(r.type)) return { url: r.url, html: r.text, links: linksFromHtml(r.text, r.url), via: "fetch" };
  let b = null;
  for (let attempt = 0; attempt < 2 && !b; attempt++) {
    try { b = await fetchWithBrowser(url); } catch { b = null; }
    if (!b && attempt === 0) { await closeBrowser().catch(() => {}); await sleep(2000); }   // a crashed browser is relaunched by the next call
  }
  if (!b || CHALLENGE.test(b.html.slice(0, 4000))) return null;
  const links = linksFromHtml(b.html, b.url); const seen = new Set(links.map((l) => l.url));
  for (const l of b.links) if (!seen.has(l.url)) { seen.add(l.url); links.push(l); }
  return { url: b.url, html: b.html, links, via: "browser" };
}

// --- what to follow and what to read -----------------------------------------------------------------
const DOC_HOST = /5il\.co\/|core-docs\.s3|assets\.thrillshare\.com|smartsites\.parentsquare\.com|drive\.google\.com\/(file|open)|docs\.google\.com\/document|resources\.finalsite\.net|files\.edl\.io|\/uploaded_file\/|\/documents\/asset\/|cdnsm\d-ss\d+\.sharpschool\.com|\.sharpschool\.com\/.*\/(lib|UserFiles)\/|myconnectsuite\.com|tb2cdn\.schoolwebmasters\.com|edlio\.com|4\.files|\/wp-content\/uploads\//i;
const isDoc = (u) => /\.(pdf|docx?)(\?|#|$)/i.test(u) || DOC_HOST.test(u);
const VENDOR = /simbli\.eboardsolutions\.com|boarddocs\.com|pol\.tasb\.org|policy\.osba|ossba\.org\/.*polic/i;
const NOISE = /bullying|wellness|transfer|privacy|meal|nutrition|acceptable use|internet|technology|title ix|nondiscrimination|non-discrimination|insurance|vaccin|immuniz|facebook|twitter|instagram|youtube|login|calendar|athletic|sports/i;
// How much a page is worth visiting, from its link text and path.
function pageScore(l) {
  const path = DRIVE_FOLDER.test(l.url) ? "/documents/drive/" : decodeURIComponent(l.url).replace(/^https?:\/\/[^/]+/, "");
  if (/^\/(events?|article|news|live-?feed|staff|calendar|athletics|apps?|o\/[^/]+\/(events?|article|news))\b/i.test(path) || /[?&]id=\d+/.test(path)) return 0;
  if (/agenda|minutes|meeting dates|bid |bond|audit|esser|budget|financ|nutrition|menu|calendar/i.test(`${l.text} ${path}`) && !/polic/i.test(`${l.text} ${path}`)) return 1;
  const t = `${l.text} ${path.replace(/[-_/]+/g, " ").replace(/\d{5,}/g, "")}`.toLowerCase();
  if (NOISE.test(t) && !/board polic|polic(y|ies) manual|policies/.test(t)) return 0;
  // Apptegy's document library: the manual is a folder a few levels down, usually under Board of Education.
  if (/^\/documents\/?$/.test(path)) return 3;
  if (/^\/documents\//.test(path) && /polic|board|handbook|discipl|conduct|student|section [a-j]\b|district information|district|administration|superintendent/.test(t)) {
    if (/discipl|conduct|corporal|behavio/.test(t)) return 8;
    if (/\bstudents?\b|section j\b|\bj\b|700/.test(t)) return 7;
    return /polic|handbook/.test(t) ? 6 : 4;
  }
  if (/board polic|polic(y|ies)[ -]?manual|policy book|school board policies|district policies/.test(t)) return 6;
  if (/\bpolicies\b|\bpolicy\b/.test(t)) return 4;
  if (/board of education|school board|\bboard\b/.test(t)) return 3;
  if (/student (conduct|discipline)|discipline|code of conduct|handbook/.test(t)) return 3;
  if (/^\s*\/?documents\/?$|\bdocuments?\b/.test(t)) return 2;
  if (/parents?|students?|district|about|administration|superintendent|resources|section [a-j]\b/.test(t)) return 1;
  return 0;
}
// How much a document is worth reading, and in what order.
function docScore(l) {
  const name = decodeURIComponent(l.url.split("/").pop() || "").replace(/\.(pdf|docx?)(\?.*)?$/i, "").replace(/[-_]+/g, " ");
  const t = `${l.text} ${name}`.toLowerCase();
  if (/corporal|paddl|spank/.test(t)) return 10;
  const code = `${l.text} | ${name}`.toLowerCase();
  if (/(^|\| )\s*(fob|fncd|fnc[a-z]?|fo-?r\d?|fo)\b/.test(code) || /(^|\| )\s*(policy|section)\s+(fob|fncd|fo)\b/.test(code)) return 9;
  if (/student discipline|discipline/.test(t)) return 8;
  if (/code of conduct|student conduct|behavio|punish/.test(t)) return 7;
  if (/board polic|polic(y|ies)[ -]?manual|policy book|policies\b/.test(t) && !NOISE.test(t)) return 6;
  if (/handbook/.test(t) && !/employee|staff|athlet|coach|parent-student-handbook-k/.test(t)) return 5;
  return 0;
}
const codeOf = (l) => {
  const name = decodeURIComponent(l.url.split("/").pop() || "").replace(/\.(pdf|docx?)(\?.*)?$/i, "");
  for (const s of [l.text, name.replace(/[-_]+/g, " ")]) { const m = s.match(/^\s*([A-Za-z]{1,5}(?:-[A-Za-z0-9]{1,3})?)(?=\s*[-:–—.]\s|\s+[A-Z])/); if (m && /^[A-Z]/.test(m[1][0].toUpperCase()) && !/^(the|policy|board|section|school|student|of|and|for|a|an|new|new)$/i.test(m[1])) return m[1].toUpperCase(); }
  return null;
};
const titleOf = (l) => (l.text && unescapeHtml(l.text).replace(/[^\x20-\x7E]/g, "").trim().length > 2 ? unescapeHtml(l.text).replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim() : decodeURIComponent(l.url.split("/").pop() || "").replace(/\.(pdf|docx?)(\?.*)?$/i, "").replace(/[-_]+/g, " ")).replace(/^\.?(pdf|docx?)\s+/i, "").replace(/^\d{4}-\d{2}-\d{2}\s+/, "").trim().slice(0, 160);

// --- reading a document ----------------------------------------------------------------------------
// Sentences, minus table-of-contents lines (dot leaders), which name the policy without stating it.
const clip = (t) => [...new Set(t.split(/(?<=[.;:])\s+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s) && !/\.{5,}|(?:\. ){5,}/.test(s) && !NOT_THIS.some((n) => s.toLowerCase().includes(n))))];
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
function lastRevised(t) {
  const re = new RegExp(`(?:adopted|revised|reviewed|amended|adoption date|revision date|approved)[^\\n]{0,20}?((?:${MONTHS})\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})`, "gi");
  let best = null; for (const m of t.matchAll(re)) { const d = new Date(m[1]); if (!isNaN(d) && d.getFullYear() > 1980 && d.getFullYear() <= 2027 && (!best || d > best)) best = d; }
  return best ? best.toISOString().slice(0, 10) : null;
}
function docUrl(u) {
  const v = u.match(/docs\.google\.com\/(?:viewer|gview)\?.*?url=([^&]+)/); if (v) return docUrl(decodeURIComponent(v[1]));
  let m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/); if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  m = u.match(/docs\.google\.com\/document\/d\/([\w-]+)/); if (m) return `https://docs.google.com/document/d/${m[1]}/export?format=txt`;
  return u;
}
async function readDoc(url) {
  const r = await get(docUrl(url), { binary: true, timeout: 90_000 }); if (!r) return null;
  // The source a person opens: a Google link stays as linked, not the download host it redirects to.
  if (/google\.com/.test(url)) r.url = url;
  const head = r.buf.subarray(0, 8).toString("latin1");
  const tmp = join(tmpdir(), `ok-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    if (head.startsWith("%PDF")) {
      writeFileSync(tmp + ".pdf", r.buf);
      let t = execFileSync("pdftotext", ["-enc", "UTF-8", tmp + ".pdf", "-"], { maxBuffer: 64e6, timeout: 120_000 }).toString("utf8");
      // A scanned policy (a signed page photographed into a PDF) has no text layer; OCR the short ones.
      if (t.trim().length < 500) {
        let pages = 0; try { pages = Number((execFileSync("pdfinfo", [tmp + ".pdf"]).toString().match(/Pages:\s+(\d+)/) || [])[1] || 0); } catch {}
        if (pages && pages <= 40) { try { execFileSync("ocrmypdf", ["--force-ocr", "--sidecar", tmp + ".txt", "--quiet", tmp + ".pdf", "/dev/null"], { timeout: 420_000 }); t = readFileSync(tmp + ".txt", "utf8"); } catch {} }
      }
      return { text: t, url: r.url };
    }
    if (head.startsWith("\xD0\xCF\x11\xE0")) { writeFileSync(tmp + ".doc", r.buf); const t = execFileSync("textutil", ["-convert", "txt", "-stdout", tmp + ".doc"], { maxBuffer: 64e6, timeout: 60_000 }).toString("utf8"); return { text: t, url: r.url }; }
    if (head.startsWith("PK")) { writeFileSync(tmp + ".docx", r.buf); const t = execFileSync("textutil", ["-convert", "txt", "-stdout", tmp + ".docx"], { maxBuffer: 64e6, timeout: 60_000 }).toString("utf8"); return { text: t, url: r.url }; }
    if (/html/.test(r.type) || /^\s*<(!doctype|html)/i.test(r.buf.subarray(0, 200).toString("utf8"))) { const h = r.buf.toString("utf8"); if (CHALLENGE.test(h.slice(0, 4000)) || /drive\.google/.test(r.url)) return null; return { text: htmlText(h), url: r.url }; }
    return { text: r.buf.toString("utf8"), url: r.url };
  } catch { return null; } finally { for (const ext of [".pdf", ".docx", ".doc", ".txt"]) try { unlinkSync(tmp + ext); } catch {} }
}

// --- one district --------------------------------------------------------------------------------
function siteGuesses(w) {
  let u = (w || "").trim(); if (!u) return [];
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  const h = new URL(u).host.replace(/^www\./, "");
  return [...new Set([u, `https://www.${h}/`, `https://${h}/`, `http://${h}/`])];
}
// Walk from a set of starting pages, collecting documents worth reading, and read the best of them.
async function walk(d, origin, seeds, seedDocs = []) {
  const host = new URL(origin).host.replace(/^www\./, "");
  const sameSite = (u) => { try { const h = new URL(u).host.replace(/^www\./, ""); return h === host || h.endsWith("." + host.split(".").slice(-2).join(".")); } catch { return false; } };
  const docs = new Map(), visited = new Set(), vendors = new Set();
  for (const l of seedDocs) docs.set(l.url, l);
  const queue = seeds.map((s) => ({ ...s, url: s.url.replace(/#.*$/, "") }));
  const take = (p, depth) => {
    // Inside a board-policies folder every file is a policy, named or not (Altus files its whole student series as "700 Series").
    const inPolicyTree = depth > 0 && /polic/i.test(decodeURIComponent(p.url) + " " + ((p.html.match(/<title[^>]*>([^<]{1,160})/i) || [])[1] || ""));
    // Some districts post the policy as a web page rather than a file; keep the page's own text then.
    if (depth > 0) { const body = htmlText(p.html); if (hasAnchor(body) && !docs.has(p.url)) docs.set(p.url, { url: p.url, text: (p.html.match(/<title[^>]*>([^<]{1,160})/i) || [])[1]?.trim() || "page", score: 8, inline: body }); }
    for (const l of p.links) {
      if (VENDOR.test(l.url)) { vendors.add(l.url); continue; }
      if (isDoc(l.url)) { const s = docScore(l) || (inPolicyTree ? 4 : 0); if (s && (!docs.has(l.url) || docs.get(l.url).score < s)) docs.set(l.url, { ...l, score: s }); continue; }
      if (!(sameSite(l.url) || DRIVE_FOLDER.test(l.url)) || /\.(jpe?g|png|gif|svg|css|js|ico|mp4)(\?|$)/i.test(l.url)) continue;
      const clean = l.url.replace(/#.*$/, ""); if (visited.has(clean)) continue;
      const s = pageScore(l); if (s >= (depth === 0 ? 1 : 2)) queue.push({ url: clean, text: l.text, score: s + (depth === 0 ? 0.5 : 0), depth: depth + 1 });
    }
  };
  let pages = 0;
  while (queue.length && pages < PAGE_BUDGET) {
    queue.sort((a, b) => b.score - a.score || a.depth - b.depth);
    const n = queue.shift(); if (visited.has(n.url) || n.depth > (/\/documents\//.test(n.url) || DRIVE_FOLDER.test(n.url) ? 6 : 3)) continue;
    // Stop walking low-value pages once the policy documents are in hand.
    if (n.score < 3 && [...docs.values()].some((x) => x.score >= 8)) break;
    visited.add(n.url); pages++;
    const p = await page(n.url); if (DEBUG) console.log(`    page ${n.score} d${n.depth} ${n.url} ${p ? p.via + " " + p.links.length + " links" : "FAILED"}`); if (!p) continue;
    take(p, n.depth);
  }
  const picked = [...docs.values()].sort((a, b) => b.score - a.score).slice(0, DOC_BUDGET);
  if (DEBUG) { console.log(`    ${pages} pages; queue left ${queue.length}: ${queue.slice(0, 8).map((q) => q.score + " " + q.text).join(" / ")}`); for (const x of picked) console.log(`    doc ${x.score} ${x.text} ${x.url}`); }
  if (!picked.length) return { nces_id: d.nces_id, name: d.name, error: vendors.size ? `manual on a vendor: ${[...vendors][0]}` : `no policy or discipline documents found on the site (${pages} pages read)`, url: origin };
  const policies = [];
  for (const l of picked) {
    const r = l.inline ? { text: l.inline, url: l.url } : await readDoc(l.url); if (!r || !r.text || r.text.trim().length < 200) continue;
    policies.push({ code: codeOf(l), title: titleOf(l), url: r.url, candidates: clip(r.text).slice(0, 40), last_revised: lastRevised(r.text), _score: l.score });
    // A policy named for corporal punishment answers the question; stop reading once two such are read.
    if (policies.filter((p) => p.candidates.length && p._score >= 8).length >= 2) break;
  }
  if (!policies.length) return { nces_id: d.nces_id, name: d.name, error: `documents found but none readable (${picked.length} tried: ${picked.slice(0, 3).map((x) => x.url).join(" ")})`, url: origin };
  const kept = policies.filter((p) => p.candidates.length).length ? policies.filter((p) => p.candidates.length) : policies.slice(0, 3);
  for (const p of kept) delete p._score;
  return { site: null, nces_id: d.nces_id, district: d.name, _state: "OK", slug: host, verdict: kept.some((p) => p.candidates.length) ? "rule" : "silent", policies: kept };
}
async function harvest(d) {
  let home = null;
  for (const u of siteGuesses(d.website)) { home = await page(u); if (home && home.html.length > 500) break; home = null; }
  if (!home) return { nces_id: d.nces_id, name: d.name, error: "site unreachable", url: d.website };
  if (DEBUG) console.log(`    home ${home.via} ${home.links.length} links`);
  return walk(d, new URL(home.url).origin, [{ url: home.url, text: "home", score: 9, depth: 0 }]);
}

// --- the search engine, for districts whose site walk found nothing ------------------------------------
// The walk fails the way a person browsing does: the manual is posted but not linked from anywhere the
// walk went (Ardmore, Altus), or the site is dead and the documents outlived it. A search engine has
// already indexed the document, so ask it for the district's own policy by the words Oklahoma manuals
// use, and keep only results on the district's own host or a document host carrying its name.
let braveChain = Promise.resolve();
function brave(q) { const p = braveChain.then(() => braveNow(q)); braveChain = p.catch(() => {}); return p; }
async function braveNow(q) {
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=15&country=us`, { headers: { Accept: "application/json", "X-Subscription-Token": BRAVE }, signal: AbortSignal.timeout(30_000) });
  if (r.status === 402 || r.status === 429) { console.error(`Brave refused: ${r.status}; stopping rather than recording empties`); process.exit(2); }
  if (!r.ok) return [];
  const j = await r.json(); await sleep(1100);
  return (j.web?.results ?? []).map((x) => ({ url: x.url, text: x.title || "", snippet: x.description || "" }));
}
const nameTokens = (n) => n.toLowerCase().replace(/\(.*?\)/g, "").split(/[^a-z]+/).filter((w) => w.length > 2 && !["public", "schools", "school", "district", "unified", "dist", "city", "county", "consolidated", "independent", "the", "and"].includes(w));
async function harvestBySearch(d) {
  const host = (() => { try { return new URL(/^https?:/.test(d.website) ? d.website : "http://" + d.website).host.replace(/^www\./, ""); } catch { return null; } })();
  const toks = nameTokens(d.name); const pretty = d.name.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  const queries = [host ? `site:${host} corporal punishment` : null, `${pretty} Oklahoma school board policy corporal punishment`].filter(Boolean);
  const docs = new Map(), seeds = [];
  for (const q of queries) {
    for (const r of await brave(q)) {
      let rh = ""; try { rh = new URL(r.url).host.replace(/^www\./, ""); } catch { continue; }
      const onHost = host && (rh === host || rh.endsWith("." + host));
      const named = toks.length && toks.every((t) => `${r.url} ${r.text} ${r.snippet}`.toLowerCase().includes(t));
      if (!onHost && !(DOC_HOST.test(r.url) && named)) continue;
      if (isDoc(r.url)) { const sc = Math.max(docScore(r), /corporal/i.test(r.snippet) ? 6 : 0); if (sc) docs.set(r.url, { ...r, score: sc }); }
      else if (onHost) { const sc = Math.max(pageScore(r), /corporal|polic/i.test(r.snippet) ? 3 : 0); if (sc >= 2 && !/live-feed|events|article|news/.test(r.url)) seeds.push({ url: r.url, text: r.text, score: sc + 1, depth: 1 }); }
    }
  }
  // A silent handbook is kept unless the search turns up something the walk did not see.
  const old = prior.find((r) => r.nces_id === d.nces_id);
  if (old && !old.error && !seeds.length && !docs.size) return { nces_id: d.nces_id, name: d.name, error: "search added nothing to a silent handbook", url: d.website };
  // Walk again from the home page too, with the search's pages and documents ahead of it in the queue.
  let home = null;
  for (const u of siteGuesses(d.website)) { home = await page(u); if (home && home.html.length > 500) break; home = null; }
  if (home) seeds.push({ url: home.url, text: "home", score: 5, depth: 0 });
  if (!seeds.length && !docs.size) return { nces_id: d.nces_id, name: d.name, error: `site unreachable and nothing found by search (${queries.length} queries)`, url: d.website };
  const origin = home ? new URL(home.url).origin : seeds.length ? new URL(seeds[0].url).origin : `https://${host}`;
  const row = await walk(d, origin, seeds.slice(0, 7), [...docs.values()]);
  if (!row.error) row.via = "search"; else row.error = "search: " + row.error;
  return row;
}

let i = 0, rule = 0, silent = 0, errs = 0;
async function worker() {
  for (;;) {
    const d = todo[i++]; if (!d) return;
    let row;
    try { row = RETRY ? await harvestBySearch(d) : await harvest(d); } catch (e) { row = { nces_id: d.nces_id, name: d.name, error: `crashed: ${String(e.message || e).slice(0, 160)}`, url: d.website }; }
    if (row.error) errs++; else if (row.verdict === "rule") rule++; else silent++;
    appendFileSync(RETRY ? OUT_RETRY : OUT, JSON.stringify(row) + "\n");
    const n = rule + silent + errs;
    console.log(`  [${n}/${todo.length}] ${d.name}: ${row.error ? "error - " + row.error.slice(0, 90) : row.verdict + " (" + row.policies.map((p) => p.code || p.title.slice(0, 20)).join(", ") + ")"}`);
  }
}
if (RETRY && !BRAVE) { console.error("--retry-search needs BRAVE_API_KEY"); process.exit(1); }
await Promise.all(Array.from({ length: WORKERS }, worker));
await closeBrowser();
if (RETRY) console.log(`retry rows in ${OUT_RETRY}; run with --merge to fold them into ${OUT}`);
console.log(`done: ${rule} districts with a rule, ${silent} silent, ${errs} errors -> ${OUT}`);
await reportOps({ pass: `boardpolicy-ok-${new Date().toISOString().slice(0, 10)}`, summary: `Mothership read Oklahoma board policy manuals on district websites: ${rule} districts' corporal punishment rules read, ${silent} silent, ${errs} not found`, units: todo.length, produced: rule, scope: "OK" });
