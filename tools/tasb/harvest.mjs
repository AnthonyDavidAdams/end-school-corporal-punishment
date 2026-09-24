// Harvest every Texas district's corporal punishment policy from TASB, deterministically.
//
// Texas is a third of the remaining queue and was the most expensive state to scan, because each
// district went through an agent. It did not need to. TASB serves ~1,200 districts at one predictable
// address -- PolicyDetails?key=N&code=FO -- and the page carries both the district's name and its own
// FO(LOCAL) policy. That is a scraper, not a swarm.
//
// This fetches, names the district from the page title, cuts the LOCAL section, and clips every
// sentence that mentions corporal punishment. It decides nothing: classification is a separate step,
// so the expensive judgment runs over a few hundred characters instead of a megabyte, and so this can
// be re-run without re-deciding anything.
//
// Run from a machine that gets the real page. TASB serves some addresses -- Railway's among them -- a
// 70,000-byte stub with HTTP 200 and none of the policy, so every response is checked for the body
// before it is believed.
//
//   node tools/tasb/harvest.mjs [--from 1] [--to 1400] [--out data/tasb/harvest.jsonl]
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 groundcrew/0.4 (+https://github.com/AnthonyDavidAdams/groundcrew)";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Number(arg("from", 1)), TO = Number(arg("to", 1400));
const OUT = join(root, arg("out", "data/tasb/harvest.jsonl"));
const CODE = arg("code", "FO");
const PACE_MS = Number(arg("pace", 1200));

// A real page is several hundred thousand characters; the stub TASB serves a rate-limited address is
// about 70,000. Size alone separates them, and size alone is the right test: requiring a DATE ISSUED
// footer as well rejected Texarkana College's genuine 632,735-byte page, which simply has no FO policy
// to date. TASB hosts colleges as well as school districts, and an entity with nothing to say about
// corporal punishment is a real answer, not a failed fetch.
const looksReal = (html) => html.length > 150_000;

// Every request through the pool leaves from a different US residential address, so TASB's per-address
// rate limit stops applying and the harvest can run several at a time instead of one every 2.5 seconds.
const PROXY = process.env.EGRESS_PROXIES?.split(",")[0]?.trim() || null;
let dispatcher = null;
if (PROXY) {
  const { ProxyAgent } = await import("undici");
  dispatcher = new ProxyAgent(PROXY);
  console.log(`routing through the proxy pool (${PROXY.replace(/\/\/[^@]*@/, "//***@")})`);
}
const { fetch: undiciFetch } = PROXY ? await import("undici") : { fetch };
const get = (url, init) => (dispatcher ? undiciFetch(url, { ...init, dispatcher }) : fetch(url, init));

const unescape = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");

function parse(html, code) {
  const title = unescape((html.match(/<title>([^<]*)<\/title>/i) || [, ""])[1]);
  // "Policy Code FO – Student Discipline – Brownfield ISD Board Policy Manual - Policy Online"
  const district = (title.match(/[–-]\s*([^–-]+?)\s+Board Policy Manual/i) || [, null])[1];

  const plain = unescape(
    html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
  ).replace(/[ \t]+/g, " ");

  // Sections are served LEGAL, LOCAL, REGULATION and each marker CLOSES its section, so a section runs
  // backwards from its own marker to the previous one.
  const re = new RegExp(`${code}\\((LOCAL|LEGAL|REGULATION|EXHIBIT)\\)`, "gi");
  const marks = [...plain.matchAll(re)].map((m) => ({ label: m[1].toUpperCase(), at: m.index }));
  const bodies = {};
  let prev = 0;
  for (const m of marks) { bodies[m.label] = plain.slice(prev, m.at).trim(); prev = m.at; }

  const local = bodies.LOCAL || "";
  // Candidate sentences, from our own clipping. Nothing downstream may invent a quote: a classifier
  // picks one of these verbatim strings, so what lands in the record is what the document says.
  const candidates = local
    .split(/(?<=[.:;])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => /corporal punishment/i.test(s) && s.length > 30 && s.length < 600
                && !/Table of Contents|PDF \| Word/i.test(s));

  const issued = (local.match(/DATE ISSUED:\s*([0-9/]+)/i) || [, null])[1];
  const update = (local.match(/UPDATE\s+(\d+)/i) || [, null])[1];
  return { district, local_chars: local.length, candidates, date_issued: issued, update };
}

async function fetchKey(key) {
  const url = `https://pol.tasb.org/PolicyOnline/PolicyDetails?key=${key}&code=${encodeURIComponent(CODE)}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await get(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow", signal: AbortSignal.timeout(45_000),
      });
      // A 404 is an answer: that key is not a district. Retrying it three times with backoff spends
      // twelve seconds learning nothing, and the key space is sparse -- most of it is 404.
      if (res.status === 404) return { key, url, error: "HTTP 404", absent: true };
      if (!res.ok) { if (attempt === 3) return { key, url, error: `HTTP ${res.status}` }; }
      else {
        const html = await res.text();
        // A stub is not a short policy. Back off and try again rather than record an empty district.
        if (!looksReal(html)) { if (attempt === 3) return { key, url, error: `stub (${html.length} chars)`, stub: true }; }
        else return { key, url, ...parse(html, CODE) };
      }
    } catch (err) { if (attempt === 3) return { key, url, error: String(err.message || err).slice(0, 120) }; }
    await new Promise((r) => setTimeout(r, 8000 * attempt));
  }
}

mkdirSync(dirname(OUT), { recursive: true });
// Resumable: a run that stops halfway is re-run with the same command and skips what it has.
const done = new Set(
  existsSync(OUT) ? readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l).key; } catch { return null; } }).filter((k) => k != null) : []
);
console.log(`harvesting TASB ${CODE} keys ${FROM}..${TO}; ${done.size} already on file`);

let found = 0, stubs = 0, misses = 0, seen = 0;
const queue = [];
for (let key = FROM; key <= TO; key++) if (!done.has(key)) queue.push(key);
const CONCURRENCY = Number(arg("workers", PROXY ? 8 : 1));
console.log(`${queue.length} keys to do, ${CONCURRENCY} at a time`);

async function worker() {
  for (;;) {
    const key = queue.shift();
    if (key === undefined) return;
    const row = await fetchKey(key);
    appendFileSync(OUT, JSON.stringify(row) + "\n");
    seen++;
    if (row.district) { found++; if (row.candidates?.length) process.stdout.write(`\n  ${key} ${row.district} — ${row.candidates.length} candidates`); }
    else if (row.stub) stubs++;
    else misses++;
    if (seen % 25 === 0) process.stdout.write(`\n[${seen}/${queue.length + seen}] ${found} districts, ${stubs} stubs, ${misses} empty`);
    // An absent key cost one cheap 404; only pace after a real page.
    if (!row.absent) await new Promise((r) => setTimeout(r, PACE_MS));
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\ndone: ${found} districts, ${stubs} stubs, ${misses} misses -> ${OUT}`);
