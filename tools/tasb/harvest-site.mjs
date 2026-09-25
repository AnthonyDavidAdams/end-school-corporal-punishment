// Walk a district's website for every document that might carry its discipline policy.
//
// The first crawler chose one link per level and followed it. That fails the way a person would not:
// "Parents & Students" and "Board of Education" are both plausible, the policy is behind one of them,
// and picking the better-sounding one is a coin flip that costs the whole district. Four of nineteen
// districts came back with a document.
//
// So score every link instead of choosing between them. Jev answers one noul per link in a single
// request -- its sampler is parallel, so forty links cost one call and about two hundredths of a cent
// -- and everything above the bar gets visited. A greedy path becomes a small tree, and a district
// with its handbook two clicks down behind the second-best link is no longer lost.
//
// It also collects rather than stops. A district's rule can live in a board policy, a code of conduct
// or a handbook, and which one is authoritative differs by state, so the right output is every
// document found and not the first.
import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hasAnchor, NOT_THIS } from "./vocabulary.mjs";
import { fetchWithBrowser, browserAvailable, closeBrowser } from "./browser.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const KEY = process.env.OPENROUTER_API_KEY;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 groundcrew/0.4 (+https://github.com/AnthonyDavidAdams/groundcrew)";
const OUT = join(root, arg("out", "data/handbooks/site-harvest.jsonl"));
const FOLLOW = Number(arg("follow", 0.35));   // visit a page if a link to it scores this or better
const KEEP = Number(arg("keep", 0.5));        // record a document at this or better
const LEVELS = Number(arg("levels", 2));
const MAX_PAGES = Number(arg("max-pages", 6));
const DOC = /\.(pdf|docx?|rtf)(\?|$)/i;

// A link to a policy vendor is the destination, not another page to walk. Simbli, TASB and BoardDocs
// all serve a JavaScript shell to a plain fetch, so following one as if it were a web page finds
// nothing and the district comes back empty -- which is what happened to Pierce County, whose own home
// page links its Simbli manual. Recognising them as documents also settles identity for free: a
// district linking S=4129 from its own site is telling us that manual is theirs, which is stronger
// than matching a name in a manual against a federal list and hoping it is unique.
const VENDORS = [
  { name: "simbli", re: /simbli\.eboardsolutions\.com[^"']*?[?&]S=(\d+)/i, id: "site" },
  { name: "tasb", re: /pol\.tasb\.org[^"']*?key=(\d+)/i, id: "district_key" },
  { name: "boarddocs", re: /boarddocs\.com\/([a-z]{2}\/[a-z0-9]+)\//i, id: "path" },
];
const vendorOf = (url) => {
  for (const v of VENDORS) { const m = url.match(v.re); if (m) return { vendor: v.name, [v.id]: m[1] }; }
  return null;
};
const CHALLENGE = /Client Challenge|Pardon Our Interruption|_Incapsula_|Just a moment|Enable JavaScript and cookies/i;

const PROXY = process.env.EGRESS_PROXIES?.split(",")[0]?.trim() || null;
let dispatcher = null, ufetch = fetch;
if (PROXY) { const u = await import("undici"); dispatcher = new u.ProxyAgent(PROXY); ufetch = u.fetch; }

// The archive is a courtesy, not a service we pay for, and it withdraws it. Several hundred unpaced
// requests during one evening's crawling and it stopped answering altogether -- including for a page it
// had served in full an hour earlier. So: one request at a time, a second between them, and a stop
// after repeated empty answers rather than continuing to ask.
//
// A snapshot that comes back EMPTY is not a snapshot without a challenge page. Treating zero bytes as
// success is how a measurement here reported 28 of 30 districts covered when the real number was none.
let archiveQueue = Promise.resolve();
let archiveEmpty = 0;
const ARCHIVE_GAP_MS = 1000;
const ARCHIVE_GIVE_UP = 8;

async function viaArchive(url) {
  if (archiveEmpty >= ARCHIVE_GIVE_UP) return null;
  const turn = archiveQueue.then(() => new Promise((r) => setTimeout(r, ARCHIVE_GAP_MS)));
  archiveQueue = turn;
  await turn;
  // Through the pool, so the archive is not being asked for everything by one address. That is what
  // exhausted its patience: hundreds of requests from here in an evening, after which it served nothing
  // at all -- including a page it had given us in full an hour before.
  const viaPool = (u, init) => (dispatcher ? ufetch(u, { ...init, dispatcher }) : fetch(u, init));
  try {
    const j = await (await viaPool(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20_000) })).json();
    const s = j?.archived_snapshots?.closest;
    if (!s?.available) return null;
    const r = await viaPool(s.url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(35_000) });
    if (!r.ok) { archiveEmpty++; return null; }
    const html = await r.text();
    // Empty, or the challenge itself, is a failed read. Say so rather than passing it on as a page.
    if (!html.length || CHALLENGE.test(html.slice(0, 4000))) { archiveEmpty++; return null; }
    archiveEmpty = 0;
    return { html, url: r.url, archived: s.timestamp };
  } catch { archiveEmpty++; return null; }
}

let canBrowse = null;
async function viaBrowser(url) {
  canBrowse ??= await browserAvailable();
  if (!canBrowse) return null;
  const r = await fetchWithBrowser(url);
  if (!r || CHALLENGE.test(r.html.slice(0, 4000)) || r.html.length < 6000) return null;
  return { ...r, via_browser: true };
}

async function get(url) {
  try {
    const opts = { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(30_000) };
    const r = await (dispatcher ? ufetch(url, { ...opts, dispatcher }) : fetch(url, opts));
    if (!r.ok) return await viaArchive(url);
    if (!/html/i.test(r.headers.get("content-type") || "")) return { doc: true, url: r.url };
    const html = await r.text();
    // Walled or a stub: run a browser, which is what the challenge is asking for. The archive is the
    // last resort rather than the first, because it is a courtesy and we have already spent most of it.
    if (CHALLENGE.test(html.slice(0, 4000)) || html.length < 6000) return (await viaBrowser(url)) ?? (await viaArchive(url));
    return { html, url: r.url };
  } catch { return (await viaBrowser(url)) ?? (await viaArchive(url)); }
}

// The original host, so the same-site rule still works on an archived page where every link has been
// rewritten onto web.archive.org.
const host = (u) => { const m = u.match(/\/web\/\d+[a-z_]*\/(https?:\/\/[^/]+)/i); try { return new URL(m ? m[1] : u).hostname; } catch { return null; } };

function links(html, base) {
  const out = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || /^(mailto|tel|javascript)/i.test(href)) continue;
    let abs; try { abs = new URL(href, base).toString(); } catch { continue; }
    const hb = host(base), ha = host(abs);
    if (hb && ha && hb !== ha && !DOC.test(abs) && !/eboardsolutions|tasb\.org|boarddocs/i.test(abs)) continue;
    if (!out.has(abs) && (text || DOC.test(abs))) out.set(abs, text.slice(0, 90) || "(document)");
  }
  return [...out].map(([url, text]) => ({ url, text }));
}

// One request, one noul per link, all scored together -- and EVERY link, not the first forty-five.
//
// Truncating cost McComb its handbook. Its home page carries 113 links, the scoring correctly put
// "Board Policies" at 0.85, and the handbook link sat past the cut where nothing ever looked at it.
// A page's links are not in order of relevance, so taking the first N is the same as taking N at
// random. Jev's window is about 32,000 tokens and a scored link costs roughly 130 of them, so a page
// is a handful of calls at two hundredths of a cent each -- there is no reason to drop any of them.
const BATCH = 45;
async function score(district, cands) {
  const out = [];
  let cost = 0, err = null;
  for (let i = 0; i < cands.length; i += BATCH) {
    const r = await scoreBatch(district, cands.slice(i, i + BATCH));
    out.push(...r.scored); cost += r.cost; err = err ?? r.error;
  }
  return { scored: out.sort((a, b) => b.p - a.p), cost, error: err };
}

async function scoreBatch(district, batch) {
  const questions = {};
  batch.forEach((c, i) => {
    questions[`l${i}`] = {
      type: "noul",
      // Prefer the board policy manual. Two thirds of the handbooks this finds do not mention corporal
      // punishment at all -- McComb's runs to 104 pages without the words, and its district reported 52
      // students struck -- because the rule is a board policy and the handbook summarises other things.
      // Both are still worth having, since which document is authoritative differs by state, but when
      // a page offers each the manual is the one to walk first.
      instructions: `Link text: "${c.text}" -> ${c.url.slice(0, 160)}\n\nIs this likely to BE, or to LEAD TO, a document stating ${district}'s rules on student discipline -- above all the BOARD POLICY MANUAL, which is where a district records what it permits, and secondarily a student code of conduct or student handbook?`,
      criteria: {
        true: "Yes. Strongest: the board policy manual, a policy system such as Simbli, TASB Policy Online or BoardDocs, or a 'Board Policies' page. Also yes: a student code of conduct, a student handbook, or a page that would link to any of these.",
        false: "No: news, athletics, staff or employee documents, calendars, lunch menus, logins, social media, enrolment forms, or anything unrelated to student discipline rules.",
      },
    };
  });
  if (!batch.length) return { scored: [], cost: 0 };
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "typesafe/jev-1.13", state: { district }, questions }), signal: AbortSignal.timeout(90_000),
  });
  const j = await res.json();
  if (!j.answers) return { scored: [], cost: 0, error: j.error?.message };
  return { scored: batch.map((c, i) => ({ ...c, p: j.answers[`l${i}`]?.noul ?? 0 })), cost: j.usage?.cost ?? 0 };
}

export async function harvestSite(district, website) {
  const seen = new Set(), docs = [];
  let queue = [{ url: website, p: 1 }], cost = 0, pages = 0, archived = null;
  for (let level = 0; level <= LEVELS && queue.length && pages < MAX_PAGES; level++) {
    const next = [];
    for (const item of queue) {
      if (pages >= MAX_PAGES || seen.has(item.url)) continue;
      seen.add(item.url); pages++;
      const page = await get(item.url);
      if (!page) continue;
      if (page.archived) archived = page.archived;
      if (page.doc) { docs.push({ url: page.url, text: item.text ?? null, p: item.p, via: "direct" }); continue; }
      // Links from the DOM when a browser fetched the page, otherwise parsed from the HTML.
      const found = page.links ? page.links.filter((l) => { const hb = host(page.url), ha = host(l.url); return !(hb && ha && hb !== ha && !DOC.test(l.url) && !/eboardsolutions|tasb\.org|boarddocs/i.test(l.url)); })
                               : links(page.html, page.url);
      const { scored, cost: c } = await score(district, found.filter((l) => !seen.has(l.url)).slice(0, 220));
      cost += c;
      for (const s of scored) {
        const v = vendorOf(s.url);
        if (v) { if (s.p >= FOLLOW) docs.push({ url: s.url, text: s.text, p: s.p, via: `level ${level}`, ...v }); }
        else if (DOC.test(s.url)) { if (s.p >= KEEP) docs.push({ url: s.url, text: s.text, p: s.p, via: `level ${level}` }); }
        else if (s.p >= FOLLOW && level < LEVELS) next.push(s);
      }
    }
    // Best-first, so a page budget is spent on the most promising branches.
    queue = next.sort((a, b) => b.p - a.p).slice(0, 4);
  }
  const uniq = [...new Map(docs.map((d) => [d.url, d])).values()].sort((a, b) => b.p - a.p);
  return { district, website, documents: uniq.slice(0, 8), pages_read: pages, cost, ...(archived ? { archived } : {}) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const targets = JSON.parse(readFileSync(join(root, arg("in", "data/handbooks/live.json")), "utf8"));
  mkdirSync(dirname(OUT), { recursive: true });
  const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).district; } catch { return null; } }) : []);
  let cost = 0, withDocs = 0, n = 0;
  const queue = targets.filter((t) => !done.has(t.name));
  console.log(`${queue.length} districts to walk`);
  const WORKERS = Number(arg("workers", 4));
  let cur = 0;
  async function worker() {
    for (;;) {
      const t = queue[cur++]; if (!t) return;
      let r; try { r = await harvestSite(t.name, t.website); } catch (e) { r = { district: t.name, website: t.website, documents: [], error: String(e.message || e) }; }
      cost += r.cost || 0; n++;
      if (r.documents?.length) { withDocs++; console.log(`  ${t.name} — ${r.documents.length} docs, best ${r.documents[0].p.toFixed(2)}: ${(r.documents[0].text || "").slice(0, 44)}`); }
      appendFileSync(OUT, JSON.stringify({ ...r, state: t.state }) + "\n");
      if (n % 20 === 0) console.log(`[${n}/${queue.length}] ${withDocs} with documents, $${cost.toFixed(4)}`);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));
  await closeBrowser();
  console.log(`\n${withDocs}/${n} districts yielded a document, $${cost.toFixed(4)}`);
}
// The MCP child and the browser are finished; do not let an open handle keep the process alive.
process.exit(0);
