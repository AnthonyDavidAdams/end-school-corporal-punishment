// Find a district's student handbook by asking which link to follow.
//
// The deterministic crawler failed on four of five districts whose handbooks are plainly linked from
// their own home pages -- elkhartisd.org has 382 links and one of them says "Handbook". The rule it
// was using ("does the URL or the anchor text match /handbook|conduct|polic/") is either too narrow
// to find "Student Information" or too broad to rank "Employee Handbook" below "Student Code of
// Conduct". That is not a pattern problem, it is a judgement, and judgement over a fixed list of
// options is a choice question.
//
// So: fetch the page, extract every link as (url, anchor text) -- deterministic -- and ask which one
// is most likely to lead to the student handbook or code of conduct. Follow it. Repeat a couple of
// levels until a document appears. No frontier model anywhere; each hop is a few thousand tokens.
import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const KEY = process.env.OPENROUTER_API_KEY;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 groundcrew/0.4 (+https://github.com/AnthonyDavidAdams/groundcrew)";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const DEPTH = Number(arg("depth", 3));
const OUT = join(root, arg("out", "data/handbooks/found.jsonl"));

const DOC = /\.(pdf|docx?|rtf)(\?|$)/i;

// District sites rate-limit by address and answer with a stub rather than an error: Crockett ISD's is
// 3,038 bytes with not one link in it, and it is the same page every time from the same address. So
// every request leaves from a different US residential address when a pool is configured, and a page
// small enough to be a stub is retried rather than believed. This is the same failure TASB had, in a
// different costume, and the same fix.
const PROXY = process.env.EGRESS_PROXIES?.split(",")[0]?.trim() || null;
let dispatcher = null, undiciFetch = fetch;
if (PROXY) {
  const u = await import("undici");
  dispatcher = new u.ProxyAgent(PROXY);
  undiciFetch = u.fetch;
}
const STUB_BYTES = 6000;
const CHALLENGE = /Client Challenge|Pardon Our Interruption|_Incapsula_|Just a moment|Enable JavaScript and cookies/i;

// When a district's own server answers with a JavaScript bot challenge, read the archive instead.
//
// These are public documents a district is required to publish, and the wall is generic bot
// protection rather than a decision to keep anyone out -- but the polite way past it is not to defeat
// it. The Internet Archive already holds the page, serves it as plain HTML, and asks nothing of us.
// The cost is freshness: a snapshot can be months old, so anything found this way carries the
// snapshot's date and the live URL, and a stale policy is a visible caveat rather than a silent one.
async function viaArchive(url) {
  try {
    const q = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(25_000) });
    const j = await q.json();
    const snap = j?.archived_snapshots?.closest;
    if (!snap?.available || !snap.url) return null;
    const res = await fetch(snap.url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(40_000) });
    if (!res.ok) return null;
    const html = await res.text();
    if (CHALLENGE.test(html.slice(0, 4000))) return null;
    return { html, url: res.url, archived: snap.timestamp ?? null, live_url: url };
  } catch { return null; }
}

async function get(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await (dispatcher
        ? undiciFetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow", dispatcher, signal: AbortSignal.timeout(35_000) })
        : fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(35_000) }));
      if (!res.ok) { if (attempt === 3) return null; }
      else {
        const type = res.headers.get("content-type") || "";
        if (!/html/i.test(type)) return { doc: true, url: res.url, type };
        const html = await res.text();
        // A page too small to hold a navigation menu is a rate limiter, not a district's home page.
        const walled = CHALLENGE.test(html.slice(0, 4000)) || html.length < STUB_BYTES;
        if (!walled) return { html, url: res.url };
        if (attempt === 3) {
          const arch = await viaArchive(url);
          if (arch) return arch;
          return { html, url: res.url, stub: true };
        }
      }
    } catch { if (attempt === 3) return null; }
    await new Promise((r) => setTimeout(r, 2500 * attempt));
  }
  return null;
}

// Every link on the page, as the two things a person would read: where it goes and what it says.
function links(html, base) {
  const out = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    let href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || /^(mailto|tel|javascript)/i.test(href)) continue;
    let abs; try { abs = new URL(href, base).toString(); } catch { continue; }
    // Stay on the district's own site; a handbook is not on Facebook. On an archived page every link
    // is rewritten onto web.archive.org, so compare the ORIGINAL host buried in the snapshot URL --
    // otherwise the same-site rule throws away the whole page, which is what it just did.
    const origin = (u) => { const m = u.match(/\/web\/\d+[a-z_]*\/(https?:\/\/[^/]+)/i); try { return new URL(m ? m[1] : u).hostname; } catch { return null; } };
    const hb = origin(base), ha = origin(abs);
    if (hb && ha && hb !== ha && !DOC.test(abs)) continue;
    if (!out.has(abs) && (text || DOC.test(abs))) out.set(abs, text.slice(0, 90) || "(no text)");
  }
  return [...out].map(([url, text]) => ({ url, text }));
}

async function pick(district, cands, seen) {
  // Options are the links we found, keyed by index; the model selects one, it never invents a URL.
  const options = {};
  cands.slice(0, 60).forEach((c, i) => { options[`l${i}`] = `${c.text} -> ${c.url.replace(/^https?:\/\/[^/]+/, "")}`; });
  options.none = "None of these is likely to lead to a student handbook or student code of conduct.";
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "typesafe/jev-1.13",
      state: { district, already_tried: seen.slice(-6), links: options },
      questions: {
        follow: {
          type: "choice",
          instructions: `Which link is most likely to be, or to lead to, ${district}'s STUDENT handbook or student code of conduct -- the document that says what students may and may not do and how they are disciplined? Prefer a student document over an employee or staff one, and a current year over an old one. Choose "none" only if nothing here could plausibly lead there.`,
          criteria: options,
        },
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await res.json();
  if (!j.answers) return null;
  const a = j.answers.follow;
  if (a.choice === "none") return { none: true, confidence: a.confidence, cost: j.usage?.cost ?? 0 };
  const idx = Number(a.choice.slice(1));
  return { pick: cands[idx], confidence: a.confidence, cost: j.usage?.cost ?? 0 };
}

export async function findHandbook(district, website) {
  const seen = [];
  let url = website, cost = 0, archived = null;
  for (let depth = 0; depth < DEPTH; depth++) {
    const page = await get(url);
    if (!page) return { district, website, error: `could not fetch ${url}`, cost };
    if (page.archived) archived = page.archived;
    if (page.doc) return { district, website, found: page.url, depth, cost, ...(archived ? { archived } : {}) };
    const cands = links(page.html, page.url).filter((c) => !seen.includes(c.url));
    if (!cands.length) return { district, website, error: page.stub ? `served a ${page.html.length}-byte stub with no links (rate limited)` : "page has no links (JavaScript-only?)", cost };
    const chosen = await pick(district, cands, seen);
    if (!chosen) return { district, website, error: "decision failed", cost };
    cost += chosen.cost;
    if (chosen.none) return { district, website, error: "model saw no plausible link", depth, cost };
    seen.push(chosen.pick.url);
    if (DOC.test(chosen.pick.url)) return { district, website, found: chosen.pick.url, text: chosen.pick.text, depth, confidence: chosen.confidence, cost, ...(archived ? { archived } : {}) };
    url = chosen.pick.url;
  }
  return { district, website, error: `no document within ${DEPTH} hops`, trail: seen, cost };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const targets = JSON.parse(readFileSync(join(root, arg("in", "data/handbooks/targets.json")), "utf8"));
  mkdirSync(dirname(OUT), { recursive: true });
  let total = 0;
  for (const t of targets) {
    const r = await findHandbook(t.name, t.website);
    total += r.cost || 0;
    appendFileSync(OUT, JSON.stringify(r) + "\n");
    console.log(r.found ? `  FOUND ${t.name}\n         ${r.found}\n         (${r.text || ""}, ${r.depth} hops, $${(r.cost||0).toFixed(5)})`
                        : `  ----- ${t.name}: ${r.error}`);
  }
  console.log(`\n  total $${total.toFixed(5)}`);
}
