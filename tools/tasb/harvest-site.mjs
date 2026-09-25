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

async function viaArchive(url) {
  try {
    const j = await (await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20_000) })).json();
    const s = j?.archived_snapshots?.closest;
    if (!s?.available) return null;
    const r = await fetch(s.url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(35_000) });
    if (!r.ok) return null;
    const html = await r.text();
    return CHALLENGE.test(html.slice(0, 4000)) ? null : { html, url: r.url, archived: s.timestamp };
  } catch { return null; }
}

async function get(url) {
  try {
    const opts = { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(30_000) };
    const r = await (dispatcher ? ufetch(url, { ...opts, dispatcher }) : fetch(url, opts));
    if (!r.ok) return await viaArchive(url);
    if (!/html/i.test(r.headers.get("content-type") || "")) return { doc: true, url: r.url };
    const html = await r.text();
    if (CHALLENGE.test(html.slice(0, 4000)) || html.length < 6000) return await viaArchive(url);
    return { html, url: r.url };
  } catch { return await viaArchive(url); }
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
      instructions: `Link text: "${c.text}" -> ${c.url.slice(0, 160)}\n\nIs this likely to BE, or to LEAD TO, a document stating ${district}'s student discipline rules -- a student handbook, a student code of conduct, or the board policy manual?`,
      criteria: { true: "Yes: a handbook, code of conduct, board policy manual, or a page that would link to one.", false: "No: news, athletics, staff, calendars, lunch menus, logins, social media, or anything unrelated to student discipline rules." },
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
      const { scored, cost: c } = await score(district, links(page.html, page.url).filter((l) => !seen.has(l.url)).slice(0, 220));
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
  console.log(`\n${withDocs}/${n} districts yielded a document, $${cost.toFixed(4)}`);
}
