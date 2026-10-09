// North Carolina's board manuals mostly live on the NCSBA policy portal (boardpolicyonline.com, a
// MicroScribe product). It is a Blazor Server app: every page is an empty shell filled over a
// SignalR socket, so a plain fetch gets nothing and this reads it with a real browser instead.
//
// The portal has no index. A district's book is found two ways: a link on the district's own site
// (boardpolicyonline.com/?b=<slug>, /bl/?b=<slug>, or v3.boardpolicyonline.com/b/[bl/]<slug>), or by
// guessing the slug from the district's name and asking the legacy host, which answers a real slug
// with a redirect to the v3 book and a bad one with "invalid book ID". Books come in two families,
// /b/<slug> and /b/bl/<slug>; the redirect says which.
//
// NC has no fixed corporal punishment policy number. NCSBA's model 4302 (School Plan for Management
// of Student Behavior) carries the prohibition for boards that ban it; boards that allow it move the
// rule into their own policy (Bladen's 4355) and 4302 points there, sometimes at a number that has
// since been reused. So each book is read three ways: its own Quick Search for "corporal", its
// contents tree for 4302 and anything titled for corporal punishment (the search index is not always
// complete), and every policy a rule-bearing sentence cites. A book with none is recorded as silent
// against its 4302, so the row still names the page a person would check.
//
//   node tools/nc/ncsba-harvest.mjs [--workers 4]   -> data/handbooks/ncsba-nc.jsonl (+ slugs map)
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { hasAnchor, NOT_THIS } from "../tasb/vocabulary.mjs";
import { reportOps } from "../lib/ops.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const WORKERS = Math.min(4, Number(arg("workers", 3)));
const OUT = join(root, "data/handbooks/ncsba-nc.jsonl");
const SLUGS = join(root, "data/handbooks/ncsba-nc-slugs.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const V3 = "https://v3.boardpolicyonline.com";

const csvRows = (t) => { const [h, ...rows] = t.trim().split("\n"); const head = h.split(",").map((x) => x.trim().toLowerCase()); const parse = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o; }; return rows.map((l) => Object.fromEntries(head.map((k, i) => [k, (parse(l)[i] ?? "").trim()]))); };
const leas = csvRows(readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8")).filter((r) => r.state === "NC" && r.lea_type.startsWith("Regular public"));
const nc = parseYaml(readFileSync(join(root, "data/districts/NC.yaml"), "utf8"));
const quoted = new Set((Array.isArray(nc) ? nc : nc.districts).filter((r) => r.quote && r.source && ["allows", "bans", "consent_required"].includes(r.status)).map((r) => String(r.nces_id)));
const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).nces_id) : []);
const todo = leas.filter((r) => !quoted.has(r.nces_id) && !done.has(r.nces_id)).slice(0, Number(arg("limit", Infinity)));
const slugMap = existsSync(SLUGS) ? JSON.parse(readFileSync(SLUGS, "utf8")) : {};
console.log(`North Carolina: ${leas.length} regular districts, ${quoted.size} already quoted, ${done.size} already read, ${todo.length} to try on the portal`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STOP = new Set(["county", "schools", "school", "city", "public", "district", "board", "of", "education", "the", "graded", "community"]);
const coreWords = (name) => name.toLowerCase().replace(/[^a-z0-9 \/-]/g, "").split(/[\s\/-]+/).filter((w) => w && !STOP.has(w));

// Slug guesses. The portal writes Alexander County Schools as "alexander", Wake as "wake_new", Bertie as
// "bertie_county", Newton-Conover as "newton_conover". Try the obvious spellings, cheapest first.
function slugs(d) {
  const core = coreWords(d.name); const c = core.join(""); const u = core.join("_"); const i = core.map((w) => w[0]).join("");
  const host = (d.website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(".")[0];
  const v = [c, core[0], u, c + "_new", core[0] + "_new", u + "_new", c + "_nc", core[0] + "_nc", u + "_nc", u + "_county_nc", core[0] + "_county_nc", u + "_county", c + "_county", core[0] + "_county", u + "_city", c + "_city", core[0] + "_city",
    c + "county", core[0] + "county", c + "cs", i + "s", i, host, host.replace(/schools?$/, ""), core.slice(0, 2).join(""), core.slice(0, 2).join("_")];
  return [...new Set(v.filter((s) => s && s.length > 2))];
}

// Plain HTTP, with retries on 5xx and network errors.
async function get(url, { redirect = "follow" } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA }, redirect, signal: AbortSignal.timeout(25_000) });
      if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) { if (attempt === 3) return null; await sleep(1500 * attempt); }
  }
}
const bookLinks = (h) => [...h.matchAll(/boardpolicyonline\.com\/(?:bl\/)?(?:\?b=|b\/(?:bl\/)?)([A-Za-z0-9_-]+)/gi)].map((m) => m[1].toLowerCase()).filter((s) => s !== "bl");
async function probe(slug) {
  const r = await get(`https://boardpolicyonline.com/?b=${slug}`, { redirect: "manual" });
  if (!r) return null;
  if (r.status === 302) { const loc = r.headers.get("location") || ""; const m = loc.match(/\/b\/((?:bl\/)?[A-Za-z0-9_-]+)/); return m ? `${V3}/b/${m[1]}` : `${V3}/b/${slug}`; }
  if (r.status === 307) {
    // The legacy host sends every unknown-to-it slug to its board-library path, which may be empty too;
    // only a redirect from there onward to a v3 book counts.
    const r2 = await get(`https://boardpolicyonline.com/bl/?b=${slug}`, { redirect: "manual" });
    const m = r2 && r2.status === 302 ? (r2.headers.get("location") || "").match(/\/b\/((?:bl\/)?[A-Za-z0-9_-]+)/) : null;
    return m ? `${V3}/b/${m[1]}` : null;
  }
  return null;
}

// Find the district's book: its own site first (home page, then up to eight policy-labelled links on
// it), then the slug guesses. Also notes when the site points at BoardDocs or Simbli instead.
async function discover(d, exclude = []) {
  const cached = slugMap[d.nces_id]; if (!exclude.length && cached && (cached.book || cached.vendor)) return cached;
  const found = new Set(); let vendor = null, vendorUrl = null;
  const scan = (h) => {
    for (const s of bookLinks(h)) found.add(s);
    if (!vendor) { const b = h.match(/https?:\/\/go\.boarddocs\.com\/[A-Za-z0-9_\/.-]+/i); const s = h.match(/https?:\/\/simbli\.eboardsolutions\.com\/[A-Za-z0-9_\/.?=&-]+/i);
      if (b) { vendor = "BoardDocs"; vendorUrl = b[0]; } else if (s) { vendor = "Simbli"; vendorUrl = s[0]; } }
  };
  if (d.website) {
    const r = await get(d.website); const h = r ? await r.text().catch(() => "") : "";
    scan(h);
    if (!found.size && h) {
      const links = [...h.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].filter((m) => /polic/i.test(m[2].replace(/<[^>]+>/g, "")) || /polic/i.test(m[1]))
        .map((m) => { try { return new URL(m[1], d.website).href; } catch { return null; } }).filter((u) => u && !/\.(pdf|jpg|png|docx?)$/i.test(u));
      for (const u of [...new Set(links)].slice(0, 8)) { const r2 = await get(u); scan(r2 ? await r2.text().catch(() => "") : ""); if (found.size) break; }
    }
  }
  let book = null, slug = null;
  for (const s of [...found, ...slugs(d)]) { if (exclude.includes(s)) continue; book = await probe(s); if (book) { slug = s; break; } await sleep(150); }
  const rec = { name: d.name, slug, book, vendor, vendorUrl, viaSite: [...found], excluded: exclude };
  slugMap[d.nces_id] = rec; writeFileSync(SLUGS, JSON.stringify(slugMap, null, 1));
  return rec;
}

const clip = (t) => [...new Set(t.split(/(?<=[.;:])\s+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s) && !NOT_THIS.some((n) => s.toLowerCase().includes(n))))];
const lastRevised = (t) => { const m = [...t.matchAll(/\b(Adopted|Amended|Revised|Updated|Reviewed)\s*:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}|[A-Z][a-z]+ [0-9]{1,2}, [0-9]{4})/g)]; return m.length ? m[m.length - 1][2] : null; };

// One browser for the run; one page per worker. The shell takes a few seconds to open its circuit and
// fill in, so every step polls for the thing it needs rather than sleeping a fixed time.
let browser = null;
async function openPage() {
  if (!browser) { const { chromium } = await import("playwright"); browser = await chromium.launch({ headless: true }); }
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
  await ctx.route("**/*", (route) => ["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue());
  return ctx.newPage();
}
const titleOf = (page) => page.evaluate(() => (document.querySelector("#policy-content-title")?.textContent || "").replace(/\s+/g, " ").trim());
const stripCode = (h1, code) => h1.replace(/^(?:[A-Za-z ]+ Code:\s*)?/i, "").replace(new RegExp("^" + code.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") + "\\s*"), "").trim();
async function waitFor(page, fn, ms = 25_000, arg = null) { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 500 }); return true; } catch { return false; } }

async function readBook(page, d, book) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await page.goto(book, { waitUntil: "domcontentloaded", timeout: 45_000 }); break; }
    catch (e) { if (attempt === 3) return { error: `book page did not load: ${String(e.message || e).slice(0, 80)}`, url: book }; await sleep(3000 * attempt); }
  }
  // The shell is filled in once the book has a title of its own and its search box exists. An empty
  // address keeps the generic title and says so.
  if (!await waitFor(page, () => document.title && !/object moved/i.test(document.title) && (document.querySelector("input[placeholder='Quick Search']") || /nothing at this address|no longer active/i.test(document.body.innerText)), 40_000)) return { error: "book shell never filled in", url: book };
  if (await page.evaluate(() => /nothing at this address/i.test(document.body.innerText))) return { error: "portal says nothing at this address", url: book, wrongBook: true };
  // Retired books stay addressable under the old slug; the district's live one is usually "<slug>_new".
  if (await page.evaluate(() => /no longer active/i.test(document.body.innerText))) return { error: "portal says this book is no longer active", url: book, wrongBook: true };
  const bookTitle = (await page.title()).trim();
  const base = page.url().replace(/\/s\/\d+.*$/, "").replace(/\/$/, "");
  // The contents tree renders a beat after the search box; the style check below reads it.
  await waitFor(page, () => /\d000\s*[-–]?\s*[A-Z]/i.test(document.body.innerText), 15_000);
  const body = await page.evaluate(() => document.body.innerText);
  if (process.env.NCSBA_DEBUG && !/4000\s*[-–]?\s*STUDENTS/i.test(body)) console.log(`  debug: ${d.name} body has no Series 4000:`, body.replace(/\s+/g, " ").slice(0, 300));
  const core = coreWords(d.name).filter((w) => w.length >= 4);
  if (!core.some((w) => bookTitle.toLowerCase().includes(w)) && !core.some((w) => body.slice(0, 3000).toLowerCase().includes(w))) return { error: `book title "${bookTitle}" does not match the district`, url: book };

  // Ask the book itself where the word appears.
  const qs = page.locator("input[placeholder='Quick Search']").first();
  await qs.fill("corporal"); await qs.press("Enter");
  const searchDone = () => /Search complete|search returned no results/i.test(document.body.innerText);
  const searched = await waitFor(page, searchDone, 30_000);
  // The result tree fills in a beat after the banner does.
  if (searched) await waitFor(page, () => [...document.querySelectorAll("[role=treeitem] .k-treeview-leaf")].some((e) => /^\(\d+\)\s+\S+ Code:/i.test((e.innerText || "").trim())), 6_000);
  const results = searched ? await page.$$eval("[role=treeitem] .k-treeview-leaf", (es) => es.map((e) => (e.innerText || "").replace(/\s+/g, " ").trim()).filter((t) => /^\(\d+\)\s+(?:[A-Za-z ]+ Code:\s*)?\d{4}/i.test(t))) : [];
  const codeOf = (label) => (label.match(/^(?:\(\d+\)\s+)?(?:[A-Za-z ]+ Code:\s*)?(\d\S*)/i) || [])[1] || label;
  const policies = [], seen = new Set(), unsettled = new Map();
  const MAX = 12;

  // Read one policy once the pane shows it.
  // Which id names the open policy depends on which tab the click came from: a search-result click
  // writes hfRestoreActiveSearchId, a contents-tree click changes the address to /s/<id> and writes
  // hfRestoreActiveSectionId. Under load the id arrives seconds after the heading does, and a
  // lagging id is always one this book already gave another policy, so the read waits for an id it
  // has not recorded yet. The one exception: the search opens its first result by itself, so a click
  // on it changes nothing, and the id it already shows is accepted when the heading matched before
  // the click. If no fresh id ever arrives the row carries no address rather than a neighbour's.
  const state = () => ({ tab: document.getElementById("hfRestoreActiveTab")?.value || "0", href: (location.href.match(/\/s\/(\d+)/) || [])[1] || "0", search: document.getElementById("hfRestoreActiveSearchId")?.value || "0", section: document.getElementById("hfRestoreActiveSectionId")?.value || "0", h1: document.querySelector("#policy-content-title")?.textContent || "" });
  const idOf = (n) => n.tab === "1" ? n.search : (n.href !== "0" ? n.href : n.section);
  const snapshot = () => page.evaluate(state);
  const used = () => new Set(policies.map((p) => (p.url || "").match(/\/s\/(\d+)/)?.[1]).filter(Boolean));
  const readPane = async (code, codeTitle, before) => {
    let sid = null;
    if (before) {
      const preOpened = before.h1.includes(code) || before.selected;
      const was = idOf(before);
      const fresh = await waitFor(page, ({ code, was, preOpened, usedIds }) => { const n = { tab: document.getElementById("hfRestoreActiveTab")?.value || "0", href: (location.href.match(/\/s\/(\d+)/) || [])[1] || "0", search: document.getElementById("hfRestoreActiveSearchId")?.value || "0", section: document.getElementById("hfRestoreActiveSectionId")?.value || "0", h1: document.querySelector("#policy-content-title")?.textContent || "" }; const id = n.tab === "1" ? n.search : (n.href !== "0" ? n.href : n.section); return n.h1.includes(code) && id !== "0" && !usedIds.includes(id) && (preOpened || id !== was); }, 30_000, { code, was, preOpened, usedIds: [...used()] });
      if (fresh) sid = idOf(await snapshot());
    } else sid = idOf(await snapshot());
    // Not marked seen: the contents tree is a second way to open the same policy and may settle.
    if (!sid || sid === "0") { unsettled.set(code, { code, title: codeTitle, url: null, candidates: [], last_revised: null, error: "policy opened but its section id never settled" }); return []; }
    await page.waitForFunction(() => (document.querySelector(".policy-content-content")?.innerText || "").length > 50, null, { timeout: 15_000 }).catch(() => {});
    const text = await page.evaluate(() => document.querySelector(".policy-content-content")?.innerText || document.querySelector(".policy-content")?.innerText || "");
    const h1 = await titleOf(page);
    // Links out of the rule's own sentences: Bladen's 4302 says corporal punishment is prohibited
    // "except as provided in policy 4355", and 4355 is where the permission lives.
    const links = await page.$$eval(".policy-content-content a[href*='/s/']", (as) => as.map((a) => [a.textContent.trim(), a.href]));
    const cited = new Set(clip(text).flatMap((c) => [...c.matchAll(/polic(?:y|ies)\s+(\d{4}(?:\/\d{4})*)/gi)].map((m) => m[1])));
    const follow = links.filter(([t]) => [...cited].some((c) => t === c || c.startsWith(t))).map(([t, href]) => ({ code: t, url: href }));
    policies.push({ code, title: stripCode(h1, code) || codeTitle, url: `${base}/s/${sid}`, candidates: clip(text).slice(0, 40), last_revised: lastRevised(text) });
    if (!(await page.evaluate(() => (document.querySelector("#policy-content-title")?.textContent || "")).catch(() => "")).includes(code)) { policies.pop(); policies.push({ code, title: codeTitle, url: null, candidates: [], last_revised: null, error: "pane changed under the read" }); seen.add(code); return []; }
    unsettled.delete(code);
    seen.add(code);
    return follow;
  };
  const opened = (c) => (document.querySelector("#policy-content-title")?.textContent || "").includes(c) && ((document.getElementById("hfRestoreActiveSearchId")?.value || "0") !== "0" || /\/s\/\d+/.test(location.href));
  const queue = [];
  const readLeaf = async (label) => {
    const code = codeOf(label); if (seen.has(code) || policies.length >= MAX) return;
    const codeTitle = label.replace(/^(?:\(\d+\)\s+)?(?:[A-Za-z ]+ Code:\s*)?\S+\s*/i, "").trim();
    try {
      // The tree re-renders after each selection; a click that lands mid-render is dropped, so settle,
      // click, and click once more if the pane has not changed.
      let ok = false; const before = await snapshot();
      const leaf = page.locator("[role=treeitem] .k-treeview-leaf", { hasText: label }).first();
      // The search opens its first result by itself; the leaf is then already selected and the id it
      // shows is this policy's.
      before.selected = await leaf.evaluate((e) => e.closest("li")?.getAttribute("aria-selected") === "true").catch(() => false);
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        await sleep(attempt === 1 ? 1500 : 3000);
        // A pointer click can wait forever on a leaf an overlay covers; the page's own handler
        // answers a dispatched click the same.
        await leaf.click({ timeout: 10_000 }).catch(() => leaf.dispatchEvent("click"));
        ok = await waitFor(page, opened, attempt === 3 ? 20_000 : 8_000, code);
      }
      if (!ok) { policies.push({ code, title: codeTitle, url: null, candidates: [], last_revised: null, error: "policy did not open" }); return; }
      queue.push(...await readPane(code, codeTitle, before));
    } catch (e) { policies.push({ code, title: codeTitle, url: null, candidates: [], last_revised: null, error: String(e.message || e).slice(0, 80) }); }
  };

  // 1. Every policy the book's own search names.
  for (const label of [...new Set(results)]) await readLeaf(label);

  // 2. The contents tree, because the search index is not always complete: Bladen's search named only
  //    a parental-involvement policy while its 4302 carried the rule. Take 4302 and anything whose
  //    title is about corporal punishment.
  const tab = page.locator(".k-tabstrip-item", { hasText: /^Contents$/i }).first();
  if (await tab.count()) await tab.click({ timeout: 5_000 }).catch(() => {});
  else await page.getByText(/^contents$/i).first().click({ timeout: 5_000 }).catch(() => {});
  await page.getByText("EXPAND ALL", { exact: false }).first().click({ timeout: 10_000 }).catch(() => {});
  await waitFor(page, () => [...document.querySelectorAll("[role=treeitem] .k-treeview-leaf")].some((e) => /Code:\s*4302\b/i.test(e.innerText || "")), 20_000);
  const treeLabels = await page.$$eval("[role=treeitem] .k-treeview-leaf", (es) => es.map((e) => (e.innerText || "").replace(/\s+/g, " ").trim()).filter((t) => /^(?:[A-Za-z ]+ Code:\s*)?\d{4}/i.test(t)));
  for (const label of treeLabels.filter((t) => /Code:\s*4302\b/i.test(t) || /corporal/i.test(t))) await readLeaf(label);

  // 3. Policies the rule-bearing sentences point at, by direct address.
  while (queue.length && policies.length < MAX) {
    const { code, url } = queue.shift(); if (seen.has(code)) continue;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (!await waitFor(page, (c) => (document.querySelector("#policy-content-title")?.textContent || "").includes(c), 30_000, code)) { policies.push({ code, title: "", url, candidates: [], last_revised: null, error: "linked policy did not open" }); seen.add(code); continue; }
      queue.push(...await readPane(code, "", null));
    } catch (e) { policies.push({ code, title: "", url, candidates: [], last_revised: null, error: String(e.message || e).slice(0, 80) }); seen.add(code); }
  }
  for (const [code, row] of unsettled) if (!seen.has(code)) policies.push(row);
  // The policy that is about corporal punishment first, then 4302, then the rest in the order read,
  // so the pool the classifier sees leads with the rule rather than a passing mention.
  const rank = (p) => (/corporal/i.test(p.title) ? 0 : p.code === "4302" ? 1 : 2);
  policies.sort((a, b) => rank(a) - rank(b));
  if (!searched && !policies.length) return { error: "quick search never completed and 4302 not in the table of contents", url: book, bookTitle };
  // The host serves other states' manuals too, and county names repeat: "beaufort" is South Carolina's
  // and "chatham" New Jersey's. An NCSBA manual files students under Series 4000 and has a 4302.
  const ncsbaStyle = /(?:Series\s*)?4000\s*[-–]?\s*STUDENTS/i.test(body) || policies.some((p) => /^4\d{3}/.test(p.code) && p.url);
  if (!ncsbaStyle) return { error: `book "${bookTitle}" has no NCSBA-style student series (another state's district of the same name, or an empty book)`, url: book, wrongBook: true };
  return { bookTitle, policies, ncsbaStyle };
}

let i = 0, found = 0, rule = 0, silent = 0, nobook = 0, vendorN = 0, errs = 0;
const row = (o) => appendFileSync(OUT, JSON.stringify(o) + "\n");
async function worker() {
  const page = await openPage();
  try {
    for (;;) {
      const d = todo[i++]; if (!d) return;
      let disc = await discover(d);
      if (!disc.book) {
        if (disc.vendor) { vendorN++; row({ nces_id: d.nces_id, name: d.name, error: `board policies hosted on ${disc.vendor}, not the NCSBA portal`, url: disc.vendorUrl }); }
        else { nobook++; row({ nces_id: d.nces_id, name: d.name, error: "no portal book found by site link or any guessed slug" }); }
        continue;
      }
      let r = await readBook(page, d, disc.book);
      // A wrong or retired book under a bare county name: look again, skipping it, until the spellings
      // run out. Each pass re-reads the district's own site first, so a link there wins over a guess.
      const bad = [disc.slug];
      while (r.wrongBook) {
        const next = await discover(d, bad);
        if (!next.book) { if (next.vendor) { disc = { ...next }; } break; }
        bad.push(next.slug);
        const r2 = await readBook(page, d, next.book);
        if (!r2.error || !r2.wrongBook) { disc = next; r = r2; break; }
        r = r2;
      }
      if (!disc.book) {
        if (disc.vendor) { vendorN++; row({ nces_id: d.nces_id, name: d.name, error: `board policies hosted on ${disc.vendor}, not the NCSBA portal`, url: disc.vendorUrl }); }
        else { nobook++; row({ nces_id: d.nces_id, name: d.name, error: "no portal book found by site link or any guessed slug" }); }
        continue;
      }
      if (r.error) { errs++; row({ nces_id: d.nces_id, name: d.name, slug: disc.slug, error: r.error, url: r.url || disc.book }); console.log(`  ! ${d.name}: ${r.error}`); continue; }
      const cands = r.policies.reduce((n, p) => n + p.candidates.length, 0);
      found++; if (cands) rule++; else silent++;
      row({ site: null, nces_id: d.nces_id, district: d.name, _state: "NC", slug: disc.slug, book: disc.book, book_title: r.bookTitle, ncsba_style: r.ncsbaStyle, verdict: cands ? "rule" : "silent", policies: r.policies });
      console.log(`  ${d.name} [${disc.slug}] -> ${cands ? "rule" : "silent"} (${r.policies.map((p) => p.code).join(", ") || "no policy"})`);
    }
  } finally { await page.context().close().catch(() => {}); }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
if (browser) await browser.close().catch(() => {});
console.log(`done: ${found} books read (${rule} rule, ${silent} silent), ${nobook} no book found, ${vendorN} on BoardDocs/Simbli, ${errs} errors -> ${OUT}`);
await reportOps({ pass: `ncsba-nc-${new Date().toISOString().slice(0, 10)}`, summary: `Mothership read North Carolina board policy on the NCSBA portal: ${found} districts' manuals searched for corporal punishment, ${rule} with a rule, ${nobook + vendorN} not on the portal`, units: todo.length, produced: found, scope: "NC" });
process.exit(0);
